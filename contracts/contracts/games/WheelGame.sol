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

/// @title WheelGame — Provably fair wheel with three risk modes
/// @notice Three modes (LOW=0, MED=1, HIGH=2) each with 6 weighted segment types.
///         VRF determines stop position; segment multiplier drives payout.
///         Multipliers stored in ×100 units (200 = 2.00×, 0 = 0×).
contract WheelGame is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IGame
{
    bytes32 public constant GAME_ID       = keccak256("WHEEL");
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

    // ── Wheel configs ──────────────────────────────────────────────────────────
    // Each mode: 6 segment types, each with [weight, multiplier×100]
    // Total weight per mode = 54
    //
    // LOW:  [18×0, 16×120, 10×150, 6×200, 3×300, 1×500]      totalWeight=54
    // MED:  [25×0, 13×150, 8×200,  5×500, 2×1000, 1×2500]    totalWeight=54
    // HIGH: [32×0, 11×200, 6×500,  3×1000, 1×5000, 1×10000]  totalWeight=54

    uint256 constant TOTAL_WEIGHT = 54;

    uint8 constant NUM_MODES    = 3;
    uint8 constant NUM_SEGS     = 6;

    // weights[mode][segIndex]
    uint8[6][3] private _weights;

    // multipliers×100 [mode][segIndex]
    uint32[6][3] private _mults;

    struct Round {
        address player;
        uint256 stake;
        uint8   riskMode;       // 0=low, 1=med, 2=high
        uint256 stopPosition;   // VRF stop position [0, TOTAL_WEIGHT)
        uint8   segmentIndex;   // resolved segment index [0, 5]
        uint256 multiplier100;  // landed multiplier ×100
        uint256 netPayout;
        bool    settled;
        uint64  createdAt;
        /// @dev v2: true = custodial bet; funds tracked in DB, no on-chain token transfers
        bool    custodial;
    }

    mapping(bytes32 => Round)   public rounds;
    mapping(uint256 => bytes32) public vrfToRound;

    event BetPlaced(bytes32 indexed roundId, address indexed player, uint256 stake, uint8 riskMode);
    event RoundSettled(
        bytes32 indexed roundId, address indexed player,
        uint256 stopPosition, uint8 segmentIndex, uint256 multiplier100,
        bool won, uint256 netPayout, uint256 fee
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

        _weights[0] = [18, 16, 10, 6, 3, 1];
        _weights[1] = [25, 13,  8, 5, 2, 1];
        _weights[2] = [32, 11,  6, 3, 1, 1];

        _mults[0] = [uint32(0), 120, 150, 200,  300,   500];
        _mults[1] = [uint32(0), 150, 200, 500, 1000,  2500];
        _mults[2] = [uint32(0), 200, 500, 1000, 5000, 10000];
    }

    /// @notice Spin the wheel on behalf of a player (OPERATOR only — custodial flow).
    ///         Funds tracked in off-chain DB — no token pull from player wallet.
    ///         Chainlink VRF still resolves the stop position on-chain.
    function spinFor(address player, uint256 stake, uint8 riskMode)
        external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(player != address(0), "invalid player");
        require(stake >= minStake && stake <= maxStake, "stake out of range");
        require(riskMode < NUM_MODES, "invalid risk mode");

        // Use "wheel-c" prefix to distinguish custodial rounds
        roundId = keccak256(abi.encodePacked("wheel-c", player, block.timestamp, stake, riskMode));

        rounds[roundId] = Round({
            player:        player,
            stake:         stake,
            riskMode:      riskMode,
            stopPosition:  0,
            segmentIndex:  0,
            multiplier100: 0,
            netPayout:     0,
            settled:       false,
            createdAt:     uint64(block.timestamp),
            custodial:     true
        });

        uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
        vrfToRound[vrfId] = roundId;

        emit BetPlaced(roundId, player, stake, riskMode);
    }

    /// @notice Spin the wheel.
    /// @param riskMode 0=low, 1=med, 2=high
    function spin(uint256 stake, uint8 riskMode)
        external whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(stake >= minStake && stake <= maxStake, "stake out of range");
        require(riskMode < NUM_MODES, "invalid risk mode");

        // Max possible payout: mode HIGH, seg 5 (10000×)
        uint256 maxMult = _mults[riskMode][NUM_SEGS - 1];
        uint256 maxGross = (stake * maxMult) / 100;
        require(treasury.canPay(maxGross > 0 ? maxGross : stake), "house insolvent");

        roundId = keccak256(abi.encodePacked("wheel", msg.sender, block.timestamp, stake, riskMode));

        rounds[roundId] = Round({
            player:        msg.sender,
            stake:         stake,
            riskMode:      riskMode,
            stopPosition:  0,
            segmentIndex:  0,
            multiplier100: 0,
            netPayout:     0,
            settled:       false,
            createdAt:     uint64(block.timestamp),
            custodial:     false
        });

        treasury.lockStake(GAME_ID, roundId, msg.sender, stake);
        uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
        vrfToRound[vrfId] = roundId;

        emit BetPlaced(roundId, msg.sender, stake, riskMode);
    }

    function fulfillRandomness(uint256 vrfRequestId, uint256[] memory randomWords) external override {
        require(msg.sender == address(randomness), "only coordinator");

        bytes32 roundId = vrfToRound[vrfRequestId];
        Round storage r = rounds[roundId];
        require(!r.settled, "already settled");

        r.settled = true;
        r.stopPosition = GameMath.vrfToWheelStop(randomWords[0], TOTAL_WEIGHT);

        // Resolve which segment contains this stop
        uint8 mode = r.riskMode;
        uint256 cumulative = 0;
        uint8 seg = 0;
        for (uint8 i = 0; i < NUM_SEGS; i++) {
            cumulative += _weights[mode][i];
            if (r.stopPosition < cumulative) { seg = i; break; }
        }
        r.segmentIndex  = seg;
        r.multiplier100 = _mults[mode][seg];

        uint256 fee = 0;
        bool won = r.multiplier100 > 0;

        if (!r.custodial) {
            // ── Original flow: real token transfers through treasury ───────────
            if (won) {
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
            // DB balance updated off-chain by backend once it reads the settled round.
            if (won) {
                uint256 gross = (r.stake * r.multiplier100) / 100;
                GameMath.Settlement memory s = GameMath.settle(r.stake, gross);
                r.netPayout = s.netPayout;
                fee = s.feeAmount;
            }
            // Loss: nothing to do on-chain; stake already debited from DB.
        }

        emit RoundSettled(roundId, r.player, r.stopPosition, r.segmentIndex, r.multiplier100, won, r.netPayout, fee);
    }

    /// @notice Helper: get segment weights and multipliers for a given risk mode
    function getConfig(uint8 riskMode)
        external view returns (uint8[6] memory weights, uint32[6] memory mults)
    {
        require(riskMode < NUM_MODES, "invalid mode");
        weights = _weights[riskMode];
        mults   = _mults[riskMode];
    }

    function getRound(bytes32 roundId) external view returns (Round memory) { return rounds[roundId]; }
    function gameName() external pure override returns (string memory) { return "Wheel"; }
    function gameId()   external pure override returns (bytes32)       { return GAME_ID; }

    function setLimits(uint256 min_, uint256 max_) external onlyRole(OPERATOR_ROLE) {
        minStake = min_; maxStake = max_;
    }
    function pause()   external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
