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

/// @title LimboGame — Pick a target multiplier; win if the generated value is >= target
/// @notice Player picks target in [101, 1_000_000] (×100 units: 101 = 1.01×, 1_000_000 = 10000×)
///         VRF generates a Pareto-distributed value; player wins if value >= target.
///         Gross payout = stake × target / 100; fee = 10% of profit only.
contract LimboGame is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IGame
{
    bytes32 public constant GAME_ID       = keccak256("LIMBO");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    TreasuryVault         public treasury;
    RandomnessCoordinator public randomness;
    uint256 public minStake;
    uint256 public maxStake;
    uint256 public maxTargetBps; // default 1_000_000 (10000×)

    uint256 private _reentrancyStatus;
    modifier nonReentrant() {
        require(_reentrancyStatus == 0, "reentrant");
        _reentrancyStatus = 1; _; _reentrancyStatus = 0;
    }

    struct Round {
        address player;
        uint256 stake;
        uint256 targetBps;   // player's chosen target in ×100 units
        uint256 generated;   // VRF-derived generated value in ×100 units
        uint256 netPayout;
        bool    won;
        bool    settled;
        uint64  createdAt;
    }

    mapping(bytes32 => Round)   public rounds;
    mapping(uint256 => bytes32) public vrfToRound;

    event BetPlaced(bytes32 indexed roundId, address indexed player, uint256 stake, uint256 targetBps);
    event RoundSettled(
        bytes32 indexed roundId, address indexed player,
        uint256 generated, uint256 targetBps, bool won,
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
        treasury    = TreasuryVault(treasury_);
        randomness  = RandomnessCoordinator(randomness_);
        minStake    = min_;
        maxStake    = max_;
        maxTargetBps = 1_000_000; // 10000×
    }

    /// @notice Place a Limbo bet.
    /// @param targetBps Player's target multiplier (×100): 101 = 1.01×, 200 = 2.00×, etc.
    function placeBet(uint256 stake, uint256 targetBps)
        external whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(stake >= minStake && stake <= maxStake, "stake out of range");
        require(targetBps >= 101 && targetBps <= maxTargetBps, "invalid target");

        uint256 gross = GameMath.limboGross(stake, targetBps);
        require(treasury.canPay(gross), "house insolvent");

        roundId = keccak256(abi.encodePacked("limbo", msg.sender, block.timestamp, stake, targetBps));

        rounds[roundId] = Round({
            player:    msg.sender,
            stake:     stake,
            targetBps: targetBps,
            generated: 0,
            netPayout: 0,
            won:       false,
            settled:   false,
            createdAt: uint64(block.timestamp)
        });

        treasury.lockStake(GAME_ID, roundId, msg.sender, stake);
        uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
        vrfToRound[vrfId] = roundId;

        emit BetPlaced(roundId, msg.sender, stake, targetBps);
    }

    function fulfillRandomness(uint256 vrfRequestId, uint256[] memory randomWords) external override {
        require(msg.sender == address(randomness), "only coordinator");

        bytes32 roundId = vrfToRound[vrfRequestId];
        Round storage r = rounds[roundId];
        require(!r.settled, "already settled");

        r.settled   = true;
        r.generated = GameMath.vrfToLimboMultiplier(randomWords[0]);
        r.won       = r.generated >= r.targetBps;

        uint256 fee = 0;
        if (r.won) {
            uint256 gross = GameMath.limboGross(r.stake, r.targetBps);
            GameMath.Settlement memory s = GameMath.settle(r.stake, gross);
            r.netPayout = s.netPayout;
            fee = s.feeAmount;
            treasury.payout(GAME_ID, roundId, r.player, s.netPayout, s.feeAmount);
        } else {
            treasury.refundLoss(GAME_ID, roundId, r.player, r.stake);
        }

        emit RoundSettled(roundId, r.player, r.generated, r.targetBps, r.won, r.netPayout, fee);
    }

    function getRound(bytes32 roundId) external view returns (Round memory) { return rounds[roundId]; }
    function gameName() external pure override returns (string memory) { return "Limbo"; }
    function gameId()   external pure override returns (bytes32)       { return GAME_ID; }

    function setLimits(uint256 min_, uint256 max_, uint256 maxTarget_) external onlyRole(OPERATOR_ROLE) {
        minStake = min_; maxStake = max_; maxTargetBps = maxTarget_;
    }
    function pause()   external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
