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

/// @title CrashGame — Auto-cashout crash game settled fully onchain via VRF
/// @notice Player sets an auto-cashout multiplier target.
///         VRF generates crash point. Win if crashPoint >= target.
///         Gross payout = stake × target / 100; fee = 10% of profit only.
/// @dev Live manual cashout (watch the multiplier rise and click out) is not supported
///      because it would require L2-speed block time or off-chain oracle for UX.
///      Auto-cashout mode provides full onchain determinism with identical EV.
contract CrashGame is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IGame
{
    bytes32 public constant GAME_ID       = keccak256("CRASH");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    TreasuryVault         public treasury;
    RandomnessCoordinator public randomness;
    uint256 public minStake;
    uint256 public maxStake;
    uint256 public maxAutoCashoutBps; // default 1_000_000 (10000×)

    uint256 private _reentrancyStatus;
    modifier nonReentrant() {
        require(_reentrancyStatus == 0, "reentrant");
        _reentrancyStatus = 1; _; _reentrancyStatus = 0;
    }

    struct Round {
        address player;
        uint256 stake;
        uint256 autoCashoutBps; // player's auto-cashout target (×100 units)
        uint256 crashPoint;     // VRF-derived crash point (×100 units)
        uint256 netPayout;
        bool    won;
        bool    settled;
        uint64  createdAt;
    }

    mapping(bytes32 => Round)   public rounds;
    mapping(uint256 => bytes32) public vrfToRound;

    event BetPlaced(bytes32 indexed roundId, address indexed player, uint256 stake, uint256 autoCashoutBps);
    event RoundSettled(
        bytes32 indexed roundId, address indexed player,
        uint256 crashPoint, uint256 autoCashoutBps, bool won,
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
        treasury         = TreasuryVault(treasury_);
        randomness       = RandomnessCoordinator(randomness_);
        minStake         = min_;
        maxStake         = max_;
        maxAutoCashoutBps = 1_000_000;
    }

    /// @notice Place a Crash bet with auto-cashout target.
    /// @param autoCashoutBps Auto-cashout multiplier (×100): 110 = 1.10×, 200 = 2.00×, etc.
    function placeBet(uint256 stake, uint256 autoCashoutBps)
        external whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(stake >= minStake && stake <= maxStake, "stake out of range");
        require(autoCashoutBps >= 101 && autoCashoutBps <= maxAutoCashoutBps, "invalid cashout target");

        uint256 gross = GameMath.limboGross(stake, autoCashoutBps);
        require(treasury.canPay(gross), "house insolvent");

        roundId = keccak256(abi.encodePacked("crash", msg.sender, block.timestamp, stake, autoCashoutBps));

        rounds[roundId] = Round({
            player:         msg.sender,
            stake:          stake,
            autoCashoutBps: autoCashoutBps,
            crashPoint:     0,
            netPayout:      0,
            won:            false,
            settled:        false,
            createdAt:      uint64(block.timestamp)
        });

        treasury.lockStake(GAME_ID, roundId, msg.sender, stake);
        uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
        vrfToRound[vrfId] = roundId;

        emit BetPlaced(roundId, msg.sender, stake, autoCashoutBps);
    }

    function fulfillRandomness(uint256 vrfRequestId, uint256[] memory randomWords) external override {
        require(msg.sender == address(randomness), "only coordinator");

        bytes32 roundId = vrfToRound[vrfRequestId];
        Round storage r = rounds[roundId];
        require(!r.settled, "already settled");

        r.settled    = true;
        r.crashPoint = GameMath.vrfToCrashPoint(randomWords[0]);
        // Win if crash point at or above the player's chosen cashout target
        r.won = r.crashPoint >= r.autoCashoutBps;

        uint256 fee = 0;
        if (r.won) {
            uint256 gross = GameMath.limboGross(r.stake, r.autoCashoutBps);
            GameMath.Settlement memory s = GameMath.settle(r.stake, gross);
            r.netPayout = s.netPayout;
            fee = s.feeAmount;
            treasury.payout(GAME_ID, roundId, r.player, s.netPayout, s.feeAmount);
        } else {
            treasury.refundLoss(GAME_ID, roundId, r.player, r.stake);
        }

        emit RoundSettled(roundId, r.player, r.crashPoint, r.autoCashoutBps, r.won, r.netPayout, fee);
    }

    function getRound(bytes32 roundId) external view returns (Round memory) { return rounds[roundId]; }
    function gameName() external pure override returns (string memory) { return "Crash"; }
    function gameId()   external pure override returns (bytes32)       { return GAME_ID; }

    function setLimits(uint256 min_, uint256 max_, uint256 maxCashout_) external onlyRole(OPERATOR_ROLE) {
        minStake = min_; maxStake = max_; maxAutoCashoutBps = maxCashout_;
    }
    function pause()   external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
