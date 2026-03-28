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

/// @title PlinkoGame — Ball drop through pegs, lands in multiplier bin
/// @notice Path derived fully onchain from VRF word bits.
///         rows: 8, 12, or 16; risk: 0=low, 1=med, 2=high
///         Each bit of the VRF word = direction (0=left, 1=right) at each peg row.
///         Bin = count of right-steps; multiplier lookup from onchain table.
contract PlinkoGame is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IGame
{
    bytes32 public constant GAME_ID       = keccak256("PLINKO");
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
        address player;
        uint256 stake;
        uint8   rows;         // 8, 12, or 16
        uint8   risk;         // 0=low, 1=med, 2=high
        uint256 pathBits;     // low `rows` bits of VRF word
        uint256 binIndex;     // count of right-steps [0, rows]
        uint256 multiplier100; // landed multiplier ×100
        uint256 netPayout;
        bool    settled;
        uint64  createdAt;
        /// @dev v2: true = custodial bet; funds tracked in DB, no on-chain token transfers
        bool    custodial;
    }

    mapping(bytes32 => Round)   public rounds;
    mapping(uint256 => bytes32) public vrfToRound;

    event BetPlaced(bytes32 indexed roundId, address indexed player, uint256 stake, uint8 rows, uint8 risk);
    event RoundSettled(
        bytes32 indexed roundId, address indexed player,
        uint256 pathBits, uint256 binIndex, uint256 multiplier100,
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

    /// @notice Drop the ball.
    /// @param rows  8, 12, or 16
    /// @param risk  0=low, 1=med, 2=high
    function dropBall(uint256 stake, uint8 rows, uint8 risk)
        external whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(stake >= minStake && stake <= maxStake, "stake out of range");
        require(rows == 8 || rows == 12 || rows == 16, "invalid rows");
        require(risk <= 2, "invalid risk");

        // Max multiplier: bin 0 or bin rows (edges) for high risk 16-row = 1000×
        // Solvency check with worst-case multiplier for the chosen config
        uint256 maxMult = _maxMultiplier(rows, risk);
        uint256 maxGross = (stake * maxMult) / 100;
        require(treasury.canPay(maxGross), "house insolvent");

        roundId = keccak256(abi.encodePacked("plinko", msg.sender, block.timestamp, stake, rows, risk));

        rounds[roundId] = Round({
            player:        msg.sender,
            stake:         stake,
            rows:          rows,
            risk:          risk,
            pathBits:      0,
            binIndex:      0,
            multiplier100: 0,
            netPayout:     0,
            settled:       false,
            createdAt:     uint64(block.timestamp),
            custodial:     false
        });

        treasury.lockStake(GAME_ID, roundId, msg.sender, stake);
        uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
        vrfToRound[vrfId] = roundId;

        emit BetPlaced(roundId, msg.sender, stake, rows, risk);
    }

    /// @notice Place a custodial bet on behalf of a player (OPERATOR only).
    ///         Funds tracked in off-chain DB — no token pull from player wallet.
    ///         Chainlink VRF still determines the ball path; result stored on-chain.
    function dropBallFor(address player, uint256 stake, uint8 rows, uint8 risk)
        external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(player != address(0), "invalid player");
        require(stake >= minStake && stake <= maxStake, "stake out of range");
        require(rows == 8 || rows == 12 || rows == 16, "invalid rows");
        require(risk <= 2, "invalid risk");
        // No canPay() check — custodial bets settled via DB balance, not TreasuryVault

        // Use "plinko-c" prefix to distinguish custodial rounds from self-placed rounds
        roundId = keccak256(abi.encodePacked("plinko-c", player, block.timestamp, stake, rows, risk));

        rounds[roundId] = Round({
            player:        player,
            stake:         stake,
            rows:          rows,
            risk:          risk,
            pathBits:      0,
            binIndex:      0,
            multiplier100: 0,
            netPayout:     0,
            settled:       false,
            createdAt:     uint64(block.timestamp),
            custodial:     true
        });

        uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
        vrfToRound[vrfId] = roundId;

        emit BetPlaced(roundId, player, stake, rows, risk);
    }

    function fulfillRandomness(uint256 vrfRequestId, uint256[] memory randomWords) external override {
        require(msg.sender == address(randomness), "only coordinator");

        bytes32 roundId = vrfToRound[vrfRequestId];
        Round storage r = rounds[roundId];
        require(!r.settled, "already settled");

        r.settled       = true;
        r.pathBits      = GameMath.vrfToPlinkoPath(randomWords[0], r.rows);
        r.binIndex      = GameMath.plinkoBinFromPath(r.pathBits, r.rows);
        r.multiplier100 = GameMath.plinkoMultiplier100(r.rows, r.risk, r.binIndex);

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
            // DB balance will be updated off-chain by the backend once it sees the settled round.
            if (r.multiplier100 > 0) {
                uint256 gross = (r.stake * r.multiplier100) / 100;
                GameMath.Settlement memory s = GameMath.settle(r.stake, gross);
                r.netPayout = s.netPayout;
                fee = s.feeAmount;
            }
            // Loss: nothing to do on-chain; stake already debited from DB
        }

        emit RoundSettled(roundId, r.player, r.pathBits, r.binIndex, r.multiplier100, r.netPayout, fee);
    }

    /// @notice Maximum multiplier ×100 for a given rows/risk configuration
    function _maxMultiplier(uint8 rows, uint8 risk) internal pure returns (uint256) {
        // Max is always at bin 0 (edge) — symmetric table, same as bin rows
        return GameMath.plinkoMultiplier100(rows, risk, 0);
    }

    function maxMultiplierView(uint8 rows, uint8 risk) external pure returns (uint256) {
        return _maxMultiplier(rows, risk);
    }

    function getRound(bytes32 roundId) external view returns (Round memory) { return rounds[roundId]; }
    function gameName() external pure override returns (string memory) { return "Plinko"; }
    function gameId()   external pure override returns (bytes32)       { return GAME_ID; }

    function setLimits(uint256 min_, uint256 max_) external onlyRole(OPERATOR_ROLE) {
        minStake = min_; maxStake = max_;
    }
    function pause()   external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
