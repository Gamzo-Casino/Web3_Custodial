// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
// Inline reentrancy guard (OZ v5 removed ReentrancyGuardUpgradeable)
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./interfaces/IGame.sol";
import "../core/TreasuryVault.sol";
import "../core/RandomnessCoordinator.sol";
import "../libraries/GameMath.sol";

/// @title CoinFlipGame — PvP provably fair coin flip
/// @notice Player A creates a match, Player B joins, VRF settles
contract CoinFlipGame is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IGame
{
    bytes32 public constant GAME_ID = keccak256("COINFLIP");
    bytes32 public constant UPGRADER_ROLE  = keccak256("UPGRADER_ROLE");
    bytes32 public constant OPERATOR_ROLE  = keccak256("OPERATOR_ROLE");

    // ── Config ─────────────────────────────────────────────────────────────────
    TreasuryVault       public treasury;
    RandomnessCoordinator public randomness;
    uint256 public minStake; // in GZO wei
    uint256 public maxStake;

    // ── Inline reentrancy guard ────────────────────────────────────────────────
    uint256 private _reentrancyStatus;
    modifier nonReentrant() {
        require(_reentrancyStatus == 0, "ReentrancyGuard: reentrant call");
        _reentrancyStatus = 1;
        _;
        _reentrancyStatus = 0;
    }

    // ── Match state ────────────────────────────────────────────────────────────
    enum MatchStatus { PENDING, ACTIVE, SETTLED, CANCELLED }
    enum Side { HEADS, TAILS }

    struct Match {
        address  playerA;
        address  playerB;
        uint256  stake;          // per-player stake
        Side     playerAChoice;
        Side     outcome;
        address  winner;
        MatchStatus status;
        uint256  vrfRequestId;
        uint64   createdAt;
        uint64   settledAt;
    }

    mapping(bytes32 => Match) public matches; // roundId => Match
    mapping(uint256 => bytes32) public vrfToRound; // vrfRequestId => roundId
    uint256 public matchNonce; // auto-incrementing for unique roundIds

    // ── Events ─────────────────────────────────────────────────────────────────
    event MatchCreated(bytes32 indexed roundId, address indexed playerA, uint256 stake, Side side);
    event MatchJoined(bytes32 indexed roundId, address indexed playerB, uint256 vrfRequestId);
    event MatchSettled(bytes32 indexed roundId, Side outcome, address indexed winner, uint256 netPayout, uint256 fee);
    event MatchCancelled(bytes32 indexed roundId, address indexed playerA);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address admin,
        address treasury_,
        address randomness_,
        uint256 minStake_,
        uint256 maxStake_
    ) external initializer {
        __AccessControl_init();
        __Pausable_init();
        // UUPSUpgradeable in OZ v5 has no __init needed

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);

        treasury  = TreasuryVault(treasury_);
        randomness = RandomnessCoordinator(randomness_);
        minStake  = minStake_;
        maxStake  = maxStake_;
    }

    // ── Player actions ─────────────────────────────────────────────────────────

    /// @notice Player A creates a match, locking their stake
    function createMatch(uint256 stake, Side side) external whenNotPaused nonReentrant returns (bytes32 roundId) {
        require(stake >= minStake && stake <= maxStake, "stake out of range");
        require(treasury.canPay(stake), "house insolvent");

        roundId = keccak256(abi.encodePacked("coinflip", msg.sender, matchNonce++, block.timestamp));

        matches[roundId] = Match({
            playerA:      msg.sender,
            playerB:      address(0),
            stake:        stake,
            playerAChoice: side,
            outcome:      Side.HEADS, // placeholder
            winner:       address(0),
            status:       MatchStatus.PENDING,
            vrfRequestId: 0,
            createdAt:    uint64(block.timestamp),
            settledAt:    0
        });

        // Pull stake from Player A
        treasury.lockStake(GAME_ID, roundId, msg.sender, stake);

        emit MatchCreated(roundId, msg.sender, stake, side);
    }

    /// @notice Player B joins an existing PENDING match
    function joinMatch(bytes32 roundId) external whenNotPaused nonReentrant {
        Match storage m = matches[roundId];
        require(m.status == MatchStatus.PENDING, "not pending");
        require(m.playerA != msg.sender, "cannot join own match");
        require(m.playerA != address(0), "invalid match");

        m.playerB = msg.sender;
        m.status  = MatchStatus.ACTIVE;

        // Pull Player B's stake
        treasury.lockStake(GAME_ID, roundId, msg.sender, m.stake);

        // Request randomness — returns VRF request ID
        uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
        m.vrfRequestId = vrfId;
        vrfToRound[vrfId] = roundId;

        emit MatchJoined(roundId, msg.sender, vrfId);
    }

    /// @notice Cancel a PENDING match (Player A only, before anyone joins)
    function cancelMatch(bytes32 roundId) external nonReentrant {
        Match storage m = matches[roundId];
        require(m.status == MatchStatus.PENDING, "not cancellable");
        require(m.playerA == msg.sender, "not player A");

        m.status = MatchStatus.CANCELLED;
        treasury.cancelRefund(GAME_ID, roundId, msg.sender, m.stake);

        emit MatchCancelled(roundId, msg.sender);
    }

    // ── VRF fulfillment ────────────────────────────────────────────────────────

    /// @notice Called by RandomnessCoordinator when VRF fulfills
    function fulfillRandomness(uint256 vrfRequestId, uint256[] memory randomWords) external override {
        require(msg.sender == address(randomness), "only coordinator");

        bytes32 roundId = vrfToRound[vrfRequestId];
        Match storage m = matches[roundId];
        require(m.status == MatchStatus.ACTIVE, "not active");

        // Derive outcome
        bool isHeads = GameMath.vrfToCoinFlip(randomWords[0]);
        m.outcome  = isHeads ? Side.HEADS : Side.TAILS;
        m.winner   = (m.outcome == m.playerAChoice) ? m.playerA : m.playerB;
        m.status   = MatchStatus.SETTLED;
        m.settledAt = uint64(block.timestamp);

        // Settle: pot = 2 × stake; fee = 10% of profit = 10% of stake
        uint256 pot   = m.stake * 2;
        GameMath.Settlement memory s = GameMath.settle(m.stake, pot);
        address loser = (m.winner == m.playerA) ? m.playerB : m.playerA;

        // Winner gets net payout; fee stays in vault as house revenue.
        // The entire 2×stake pot (locked) is consumed by payout(net, fee).
        // No separate refundLoss needed — loser's stake is part of the pot.
        treasury.payout(GAME_ID, roundId, m.winner, s.netPayout, s.feeAmount);

        emit MatchSettled(roundId, m.outcome, m.winner, s.netPayout, s.feeAmount);
    }

    // ── Views ──────────────────────────────────────────────────────────────────

    function getMatch(bytes32 roundId) external view returns (Match memory) {
        return matches[roundId];
    }

    function gameName() external pure override returns (string memory) { return "Coin Flip"; }
    function gameId()   external pure override returns (bytes32)       { return GAME_ID; }

    // ── Admin ──────────────────────────────────────────────────────────────────

    function setLimits(uint256 min_, uint256 max_) external onlyRole(OPERATOR_ROLE) {
        minStake = min_;
        maxStake = max_;
    }

    function pause()   external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
