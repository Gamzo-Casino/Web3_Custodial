// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./interfaces/IGame.sol";
import "../core/TreasuryVault.sol";
import "../core/RandomnessCoordinator.sol";
import "../libraries/GameMath.sol";

/// @title KenoGame — Pick 1-10 numbers from 1-40; draw 10; payout by matches
/// @notice VRF seed drives Fisher-Yates shuffle of [1..40] fully onchain.
///         Picks and draws are compared onchain; paytable lookup is onchain.
///         Full end-to-end transparency: anyone can verify from VRF seed alone.
contract KenoGame is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IGame
{
    bytes32 public constant GAME_ID       = keccak256("KENO");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    TreasuryVault         public treasury;
    RandomnessCoordinator public randomness;
    uint256 public minStake;
    uint256 public maxStake;

    uint256 private _reentrancyStatus;
    modifier nonReentrant() {
        require(_reentrancyStatus == 0, "reentrant");
        _reentrancyStatus = 1; _; _reentrancyStatus = 0;
    }

    struct Round {
        address  player;
        uint256  stake;
        uint8[]  picks;       // player's chosen numbers [1..40]
        uint8[10] drawn;      // VRF-derived draw
        uint256  matchCount;
        uint256  multiplier100; // payout multiplier ×100
        uint256  netPayout;
        bool     settled;
        uint64   createdAt;
        /// @dev v2: true = custodial bet; funds tracked in DB, no on-chain token transfers
        bool     custodial;
    }

    mapping(bytes32 => Round)   public rounds;
    mapping(uint256 => bytes32) public vrfToRound;

    event BetPlaced(bytes32 indexed roundId, address indexed player, uint256 stake, uint8[] picks);
    event RoundSettled(
        bytes32 indexed roundId, address indexed player,
        uint8[10] drawn, uint256 matchCount, uint256 multiplier100,
        uint256 netPayout, uint256 fee
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address admin, address treasury_, address randomness_,
        uint256 min_, uint256 max_
    ) external initializer {
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        treasury  = TreasuryVault(treasury_);
        randomness = RandomnessCoordinator(randomness_);
        minStake  = min_;
        maxStake  = max_;
    }

    /// @notice Place a Keno bet.
    /// @param picks Array of 1-10 unique numbers, each in [1, 40]
    function placeBet(uint256 stake, uint8[] calldata picks)
        external whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(stake >= minStake && stake <= maxStake, "stake out of range");
        require(picks.length >= 1 && picks.length <= 10, "picks: 1-10 required");

        // Validate picks: unique, in [1,40]
        bool[41] memory seen;
        for (uint256 i = 0; i < picks.length; i++) {
            require(picks[i] >= 1 && picks[i] <= 40, "pick out of range");
            require(!seen[picks[i]], "duplicate pick");
            seen[picks[i]] = true;
        }

        // Max payout: picks=10, match=10 → 10000× → 1_000_000 ×100
        uint256 maxMult = GameMath.kenoPayoutMultiplier100(picks.length, picks.length);
        uint256 maxGross = (stake * maxMult) / 100;
        require(treasury.canPay(maxGross > 0 ? maxGross : stake), "house insolvent");

        roundId = keccak256(abi.encodePacked("keno", msg.sender, block.timestamp, stake, picks));

        Round storage r = rounds[roundId];
        r.player    = msg.sender;
        r.stake     = stake;
        r.settled   = false;
        r.createdAt = uint64(block.timestamp);
        for (uint256 i = 0; i < picks.length; i++) r.picks.push(picks[i]);

        treasury.lockStake(GAME_ID, roundId, msg.sender, stake);
        uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
        vrfToRound[vrfId] = roundId;

        emit BetPlaced(roundId, msg.sender, stake, picks);
    }

    /// @notice Place a custodial Keno bet on behalf of a player (OPERATOR only).
    ///         Funds tracked in off-chain DB — no token pull from player wallet.
    ///         Chainlink VRF still draws 10 numbers; result stored on-chain.
    function placeBetFor(address player, uint256 stake, uint8[] calldata picks)
        external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(player != address(0), "invalid player");
        require(stake >= minStake && stake <= maxStake, "stake out of range");
        require(picks.length >= 1 && picks.length <= 10, "picks: 1-10 required");

        bool[41] memory seen;
        for (uint256 i = 0; i < picks.length; i++) {
            require(picks[i] >= 1 && picks[i] <= 40, "pick out of range");
            require(!seen[picks[i]], "duplicate pick");
            seen[picks[i]] = true;
        }
        // No canPay() check — custodial bets settled via DB balance, not TreasuryVault

        // Use "keno-c" prefix to distinguish custodial rounds
        roundId = keccak256(abi.encodePacked("keno-c", player, block.timestamp, stake, picks));

        Round storage r = rounds[roundId];
        r.player    = player;
        r.stake     = stake;
        r.settled   = false;
        r.createdAt = uint64(block.timestamp);
        r.custodial = true;
        for (uint256 i = 0; i < picks.length; i++) r.picks.push(picks[i]);

        uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
        vrfToRound[vrfId] = roundId;

        emit BetPlaced(roundId, player, stake, picks);
    }

    function fulfillRandomness(uint256 vrfRequestId, uint256[] memory randomWords) external override {
        require(msg.sender == address(randomness), "only coordinator");

        bytes32 roundId = vrfToRound[vrfRequestId];
        Round storage r = rounds[roundId];
        require(!r.settled, "already settled");

        r.settled       = true;
        r.drawn         = GameMath.vrfToKenoNumbers(randomWords[0]);
        r.matchCount    = GameMath.kenoMatchCount(r.picks, r.drawn);
        r.multiplier100 = GameMath.kenoPayoutMultiplier100(r.picks.length, r.matchCount);

        uint256 fee = 0;

        if (!r.custodial) {
            // ── Original flow: real token transfers through treasury ───────────
            if (r.multiplier100 > 0) {
                uint256 gross = (r.stake * r.multiplier100) / 100;
                GameMath.Settlement memory s = GameMath.settle(r.stake, gross);
                r.netPayout = s.netPayout;
                fee = s.feeAmount;
                treasury.payout(GAME_ID, roundId, r.player, s.netPayout, s.feeAmount);
            } else {
                treasury.refundLoss(GAME_ID, roundId, r.player, r.stake);
            }
        } else {
            // ── Custodial flow: compute result, no token transfers ─────────────
            // DB balance updated off-chain by backend once it sees the settled round.
            if (r.multiplier100 > 0) {
                uint256 gross = (r.stake * r.multiplier100) / 100;
                GameMath.Settlement memory s = GameMath.settle(r.stake, gross);
                r.netPayout = s.netPayout;
                fee = s.feeAmount;
            }
            // Loss: nothing to do on-chain; stake already debited from DB
        }

        emit RoundSettled(roundId, r.player, r.drawn, r.matchCount, r.multiplier100, r.netPayout, fee);
    }

    function getRound(bytes32 roundId) external view returns (Round memory r) {
        r = rounds[roundId];
    }

    /// @notice Emergency refund for rounds stuck in VRF pending state.
    ///         Can be called by the player or an operator if the round is not settled
    ///         after REFUND_DELAY seconds (VRF callback failed / out of gas).
    uint256 public constant REFUND_DELAY = 1 hours;

    function refundStuck(bytes32 roundId) external nonReentrant {
        Round storage r = rounds[roundId];
        require(r.player != address(0), "round not found");
        require(!r.settled, "already settled");
        require(
            msg.sender == r.player || hasRole(OPERATOR_ROLE, msg.sender),
            "not authorized"
        );
        require(block.timestamp >= r.createdAt + REFUND_DELAY, "too early");

        r.settled = true;
        treasury.cancelRefund(GAME_ID, roundId, r.player, r.stake);

        emit RoundSettled(roundId, r.player, r.drawn, 0, 0, 0, 0);
    }

    function gameName() external pure override returns (string memory) { return "Keno"; }
    function gameId()   external pure override returns (bytes32)       { return GAME_ID; }

    function setLimits(uint256 min_, uint256 max_) external onlyRole(OPERATOR_ROLE) {
        minStake = min_; maxStake = max_;
    }
    function pause()   external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
