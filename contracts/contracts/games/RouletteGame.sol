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

/// @title RouletteGame — European Roulette with multiple wagers per spin
/// @notice Player submits up to 15 wagers. VRF generates winning number [0,36].
///         Each wager evaluated independently; net settlement is sum of all payouts.
///
/// Bet encoding (uint8 betType):
///   0  = RED         (2×)
///   1  = BLACK       (2×)
///   2  = ODD         (2×)
///   3  = EVEN        (2×)
///   4  = LOW (1-18)  (2×)
///   5  = HIGH (19-36)(2×)
///   6  = DOZEN1 (1-12)  (3×)
///   7  = DOZEN2 (13-24) (3×)
///   8  = DOZEN3 (25-36) (3×)
///   9  = COL1 (1,4,7...) (3×)
///   10 = COL2 (2,5,8...) (3×)
///   11 = COL3 (3,6,9...) (3×)
///   12-48 = STRAIGHT:N where N = betType - 12, range [0,36] (36×)
contract RouletteGame is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IGame
{
    bytes32 public constant GAME_ID       = keccak256("ROULETTE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    TreasuryVault         public treasury;
    RandomnessCoordinator public randomness;
    uint256 public minStake;
    uint256 public maxStake;
    uint256 public maxWagers; // max wagers per spin (gas limit safety)

    uint256 private _reentrancyStatus;
    modifier nonReentrant() {
        require(_reentrancyStatus == 0, "reentrant");
        _reentrancyStatus = 1; _; _reentrancyStatus = 0;
    }

    // RED numbers on a European wheel
    // Packed as a bitmap for gas efficiency: bit N = 1 if N is red
    uint256 private constant RED_BITMAP =
        (1 << 1)  | (1 << 3)  | (1 << 5)  | (1 << 7)  | (1 << 9)  |
        (1 << 12) | (1 << 14) | (1 << 16) | (1 << 18) | (1 << 19) |
        (1 << 21) | (1 << 23) | (1 << 25) | (1 << 27) |
        (1 << 30) | (1 << 32) | (1 << 34) | (1 << 36);

    struct Wager {
        uint8   betType; // encoded bet type (see above)
        uint256 stake;   // stake for this wager
    }

    struct Round {
        address player;
        uint256 totalStake;
        uint256 winningNumber;
        uint256 totalGross;    // sum of all winning wager payouts
        uint256 netPayout;
        bool    settled;
        uint64  createdAt;
        // wagers stored separately (can't store dynamic array in struct mapping)
        /// @dev v2: true = custodial bet; funds tracked in DB, no on-chain token transfers
        bool    custodial;
    }

    mapping(bytes32 => Round)     public rounds;
    mapping(bytes32 => Wager[])   public roundWagers;
    mapping(uint256 => bytes32)   public vrfToRound;

    event SpinPlaced(bytes32 indexed roundId, address indexed player, uint256 totalStake, uint256 wagerCount);
    event SpinSettled(
        bytes32 indexed roundId, address indexed player,
        uint256 winningNumber, uint256 totalGross, uint256 netPayout, uint256 fee
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
        maxWagers = 15;
    }

    /// @notice Place a roulette spin with multiple wagers.
    /// @param betTypes Array of encoded bet types (see contract docs)
    /// @param stakes   Array of stake amounts, one per wager
    function spin(uint8[] calldata betTypes, uint256[] calldata stakes)
        external whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        uint256 n = betTypes.length;
        require(n > 0 && n <= maxWagers, "invalid wager count");
        require(n == stakes.length, "length mismatch");

        uint256 totalStake = 0;
        uint256 maxPossibleGross = 0;

        for (uint256 i = 0; i < n; i++) {
            require(betTypes[i] <= 48, "invalid bet type"); // 0-11 outside, 12-48 straight
            if (betTypes[i] >= 12) {
                require(betTypes[i] - 12 <= 36, "straight number out of range");
            }
            require(stakes[i] >= minStake && stakes[i] <= maxStake, "wager stake out of range");
            totalStake += stakes[i];
            uint256 mult = _grossMultiplier(betTypes[i]);
            maxPossibleGross += stakes[i] * mult;
        }

        require(treasury.canPay(maxPossibleGross), "house insolvent");

        roundId = keccak256(abi.encodePacked("roulette", msg.sender, block.timestamp, totalStake, n));

        rounds[roundId] = Round({
            player:        msg.sender,
            totalStake:    totalStake,
            winningNumber: 0,
            totalGross:    0,
            netPayout:     0,
            settled:       false,
            createdAt:     uint64(block.timestamp),
            custodial:     false
        });

        for (uint256 i = 0; i < n; i++) {
            roundWagers[roundId].push(Wager({ betType: betTypes[i], stake: stakes[i] }));
        }

        treasury.lockStake(GAME_ID, roundId, msg.sender, totalStake);
        uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
        vrfToRound[vrfId] = roundId;

        emit SpinPlaced(roundId, msg.sender, totalStake, n);
    }

    function fulfillRandomness(uint256 vrfRequestId, uint256[] memory randomWords) external override {
        require(msg.sender == address(randomness), "only coordinator");

        bytes32 roundId = vrfToRound[vrfRequestId];
        Round storage r = rounds[roundId];
        require(!r.settled, "already settled");

        r.settled       = true;
        r.winningNumber = GameMath.vrfToRouletteNumber(randomWords[0]);

        uint256 totalGross = 0;
        Wager[] storage wagers = roundWagers[roundId];
        for (uint256 i = 0; i < wagers.length; i++) {
            if (_doesWin(wagers[i].betType, r.winningNumber)) {
                totalGross += wagers[i].stake * _grossMultiplier(wagers[i].betType);
            }
        }
        r.totalGross = totalGross;

        uint256 fee = 0;
        if (!r.custodial) {
            // ── Original flow: real token transfers through treasury ───────────
            if (totalGross > 0) {
                GameMath.Settlement memory s = GameMath.settle(r.totalStake, totalGross);
                r.netPayout = s.netPayout;
                fee = s.feeAmount;
                treasury.payout(GAME_ID, roundId, r.player, s.netPayout, s.feeAmount);
                uint256 released = s.netPayout + s.feeAmount;
                if (r.totalStake > released) {
                    treasury.refundLoss(GAME_ID, roundId, r.player, r.totalStake - released);
                }
            } else {
                treasury.refundLoss(GAME_ID, roundId, r.player, r.totalStake);
            }
        } else {
            // ── Custodial flow: compute result, no token transfers ─────────────
            // DB balance updated off-chain by backend once it sees the settled round.
            if (totalGross > 0) {
                GameMath.Settlement memory s = GameMath.settle(r.totalStake, totalGross);
                r.netPayout = s.netPayout;
                fee = s.feeAmount;
            }
        }

        emit SpinSettled(roundId, r.player, r.winningNumber, totalGross, r.netPayout, fee);
    }

    /// @notice Place a custodial roulette spin on behalf of a player (OPERATOR only).
    ///         Funds tracked in off-chain DB — no token pull from player wallet.
    ///         Chainlink VRF still generates the winning number on-chain.
    function spinFor(address player, uint8[] calldata betTypes, uint256[] calldata stakes)
        external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(player != address(0), "invalid player");
        uint256 n = betTypes.length;
        require(n > 0 && n <= maxWagers, "invalid wager count");
        require(n == stakes.length, "length mismatch");

        uint256 totalStake = 0;
        for (uint256 i = 0; i < n; i++) {
            require(betTypes[i] <= 48, "invalid bet type");
            if (betTypes[i] >= 12) {
                require(betTypes[i] - 12 <= 36, "straight number out of range");
            }
            require(stakes[i] >= minStake && stakes[i] <= maxStake, "wager stake out of range");
            totalStake += stakes[i];
        }
        // No canPay() check — custodial bets settled via DB balance, not TreasuryVault

        // Use "roulette-c" prefix to distinguish custodial rounds
        roundId = keccak256(abi.encodePacked("roulette-c", player, block.timestamp, totalStake, n));

        rounds[roundId] = Round({
            player:        player,
            totalStake:    totalStake,
            winningNumber: 0,
            totalGross:    0,
            netPayout:     0,
            settled:       false,
            createdAt:     uint64(block.timestamp),
            custodial:     true
        });

        for (uint256 i = 0; i < n; i++) {
            roundWagers[roundId].push(Wager({ betType: betTypes[i], stake: stakes[i] }));
        }

        uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
        vrfToRound[vrfId] = roundId;

        emit SpinPlaced(roundId, player, totalStake, n);
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _isRed(uint256 n) internal pure returns (bool) {
        return n > 0 && (RED_BITMAP >> n) & 1 == 1;
    }

    function _grossMultiplier(uint8 betType) internal pure returns (uint256) {
        if (betType <= 5) return 2;   // even-money bets
        if (betType <= 11) return 3;  // dozen/column bets
        return 36;                    // straight bet
    }

    function _doesWin(uint8 betType, uint256 n) internal pure returns (bool) {
        if (betType == 0)  return _isRed(n);
        if (betType == 1)  return n > 0 && !_isRed(n);           // BLACK
        if (betType == 2)  return n > 0 && n % 2 == 1;            // ODD
        if (betType == 3)  return n > 0 && n % 2 == 0;            // EVEN
        if (betType == 4)  return n >= 1 && n <= 18;              // LOW
        if (betType == 5)  return n >= 19 && n <= 36;             // HIGH
        if (betType == 6)  return n >= 1 && n <= 12;              // DOZEN1
        if (betType == 7)  return n >= 13 && n <= 24;             // DOZEN2
        if (betType == 8)  return n >= 25 && n <= 36;             // DOZEN3
        if (betType == 9)  return n > 0 && n % 3 == 1;            // COL1
        if (betType == 10) return n > 0 && n % 3 == 2;            // COL2
        if (betType == 11) return n > 0 && n % 3 == 0;            // COL3
        // STRAIGHT: betType - 12 = number
        return betType >= 12 && uint256(betType - 12) == n;
    }

    function getRound(bytes32 roundId) external view returns (Round memory) { return rounds[roundId]; }
    function getWagers(bytes32 roundId) external view returns (Wager[] memory) { return roundWagers[roundId]; }
    function gameName() external pure override returns (string memory) { return "Roulette"; }
    function gameId()   external pure override returns (bytes32)       { return GAME_ID; }

    function setLimits(uint256 min_, uint256 max_, uint256 maxWagers_) external onlyRole(OPERATOR_ROLE) {
        minStake = min_; maxStake = max_; maxWagers = maxWagers_;
    }
    function pause()   external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
