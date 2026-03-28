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

/// @title DiceGame — Roll under target, instant settlement via VRF
/// @notice v2: adds placeBetFor() for custodial flow (funds tracked off-chain in DB,
///             no token escrow from player wallet). Chainlink VRF still used for randomness.
contract DiceGame is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IGame
{
    bytes32 public constant GAME_ID       = keccak256("DICE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    TreasuryVault         public treasury;
    RandomnessCoordinator public randomness;
    uint256 public minStake;
    uint256 public maxStake;

    // ── Inline reentrancy guard ────────────────────────────────────────────────
    uint256 private _reentrancyStatus;
    modifier nonReentrant() {
        require(_reentrancyStatus == 0, "ReentrancyGuard: reentrant call");
        _reentrancyStatus = 1;
        _;
        _reentrancyStatus = 0;
    }

    struct Round {
        address player;
        uint256 stake;
        uint256 targetScaled; // target × 100, e.g. 5050 = 50.50
        uint256 roll;         // actual roll [0, 9999]
        uint256 netPayout;
        bool    won;
        bool    settled;
        uint64  createdAt;
        /// @dev v2: true = custodial bet; funds tracked in DB, no on-chain token transfers
        bool    custodial;
    }

    mapping(bytes32 => Round)   public rounds;
    mapping(uint256 => bytes32) public vrfToRound;

    event BetPlaced(bytes32 indexed roundId, address indexed player, uint256 stake, uint256 targetScaled);
    event RoundSettled(bytes32 indexed roundId, address indexed player, uint256 roll, bool won, uint256 netPayout, uint256 fee);

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

    /// @notice Place a dice bet from player's own wallet (original on-chain escrow flow).
    /// @param targetScaled Target × 100 in [101, 9800] = 1.01 to 98.00
    function placeBet(uint256 stake, uint256 targetScaled)
        external whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(stake >= minStake && stake <= maxStake, "stake out of range");
        require(targetScaled >= 101 && targetScaled <= 9800, "invalid target");
        uint256 gross = GameMath.diceGross(stake, targetScaled);
        require(treasury.canPay(gross), "house insolvent");

        roundId = keccak256(abi.encodePacked("dice", msg.sender, block.timestamp, stake, targetScaled));

        rounds[roundId] = Round({
            player:       msg.sender,
            stake:        stake,
            targetScaled: targetScaled,
            roll:         0,
            netPayout:    0,
            won:          false,
            settled:      false,
            createdAt:    uint64(block.timestamp),
            custodial:    false
        });

        treasury.lockStake(GAME_ID, roundId, msg.sender, stake);
        uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
        vrfToRound[vrfId] = roundId;

        emit BetPlaced(roundId, msg.sender, stake, targetScaled);
    }

    /// @notice Place a custodial bet on behalf of a player (OPERATOR only).
    ///         Funds are tracked in the off-chain DB — no token pull from player wallet.
    ///         Chainlink VRF still determines the outcome; result stored on-chain.
    /// @param player    EVM address of the player (for on-chain record attribution).
    /// @param stake     Stake in token wei units (just a number, no transfer from player).
    /// @param targetScaled Target × 100 in [101, 9800]
    function placeBetFor(address player, uint256 stake, uint256 targetScaled)
        external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(player != address(0), "invalid player");
        require(stake >= minStake && stake <= maxStake, "stake out of range");
        require(targetScaled >= 101 && targetScaled <= 9800, "invalid target");
        // Note: no canPay() check here — custodial bets are settled via DB balance,
        // not from the on-chain TreasuryVault. House solvency is enforced in the backend.

        // Use "dice-c" prefix to distinguish custodial rounds from self-placed rounds
        roundId = keccak256(abi.encodePacked("dice-c", player, block.timestamp, stake, targetScaled));

        rounds[roundId] = Round({
            player:       player,
            stake:        stake,
            targetScaled: targetScaled,
            roll:         0,
            netPayout:    0,
            won:          false,
            settled:      false,
            createdAt:    uint64(block.timestamp),
            custodial:    true
        });

        uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
        vrfToRound[vrfId] = roundId;

        emit BetPlaced(roundId, player, stake, targetScaled);
    }

    function fulfillRandomness(uint256 vrfRequestId, uint256[] memory randomWords) external override {
        require(msg.sender == address(randomness), "only coordinator");

        bytes32 roundId = vrfToRound[vrfRequestId];
        Round storage r = rounds[roundId];
        require(!r.settled, "already settled");

        r.settled = true;
        r.roll    = GameMath.vrfToDiceRoll(randomWords[0]);
        r.won     = r.roll < r.targetScaled;

        uint256 fee = 0;

        if (!r.custodial) {
            // ── Original flow: real token transfers through treasury ───────────
            if (r.won) {
                uint256 gross = GameMath.diceGross(r.stake, r.targetScaled);
                GameMath.Settlement memory s = GameMath.settle(r.stake, gross);
                r.netPayout = s.netPayout;
                fee = s.feeAmount;
                // Win: payout sends net to player; fee stays in vault; locked accounting released
                treasury.payout(GAME_ID, roundId, r.player, s.netPayout, s.feeAmount);
            } else {
                // Lose: stake absorbed by vault bankroll
                treasury.refundLoss(GAME_ID, roundId, r.player, r.stake);
            }
        } else {
            // ── Custodial flow: compute result, no token transfers ─────────────
            // DB balance will be updated off-chain by the backend once it sees
            // the RoundSettled event (or polls getRound).
            if (r.won) {
                uint256 gross = GameMath.diceGross(r.stake, r.targetScaled);
                GameMath.Settlement memory s = GameMath.settle(r.stake, gross);
                r.netPayout = s.netPayout;
                fee = s.feeAmount;
            }
            // Loss: nothing to do on-chain; stake already debited from DB
        }

        emit RoundSettled(roundId, r.player, r.roll, r.won, r.netPayout, fee);
    }

    function getRound(bytes32 roundId) external view returns (Round memory) { return rounds[roundId]; }
    function gameName() external pure override returns (string memory) { return "Dice"; }
    function gameId()   external pure override returns (bytes32)       { return GAME_ID; }

    function setLimits(uint256 min_, uint256 max_) external onlyRole(OPERATOR_ROLE) {
        minStake = min_; maxStake = max_;
    }
    function pause()   external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
