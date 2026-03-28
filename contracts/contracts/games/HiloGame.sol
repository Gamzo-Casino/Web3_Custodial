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

/// @title HiloGame v2 — Guess Higher / Lower with compounding multiplier
///
/// v2 changes (custodial fund flow):
///   - Added `bool custodial` at end of Round struct (storage-safe)
///   - Added startRoundFor() — house wallet starts rounds on behalf of player
///   - cashout() / loseRound() / refundPending() skip treasury calls in custodial mode
///   - Fixed _hiloRank() to match TypeScript lib ordering (0%13=Two, 12%13=Ace)
///
/// Transparency model:
///   1. startRound() / startRoundFor()  — requests Chainlink VRF
///   2. VRF callback  — stores deckSeed onchain; card sequence derivable by anyone
///   3. Player makes guesses (HIGHER=0, LOWER=1, SAME=2) via backend UX
///   4. cashout() / loseRound() — verifies cards from deckSeed, replays guesses
///
/// Card deck derivation: same Fisher-Yates as BlackjackGame (keccak256 expansion).
/// For Hi-Lo, Ace is high (rank 13 > King=12 > ... > Two=1).
/// Card index layout: card % 13 → 0=Two, 1=Three, ..., 11=King, 12=Ace
contract HiloGame is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IGame
{
    bytes32 public constant GAME_ID       = keccak256("HILO");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    TreasuryVault         public treasury;
    RandomnessCoordinator public randomness;
    uint256 public minStake;
    uint256 public maxStake;
    uint256 public maxMultiplier100; // safety cap (default 1_000_000 = 10000×)

    uint256 private _reentrancyStatus;
    modifier nonReentrant() {
        require(_reentrancyStatus == 0, "reentrant");
        _reentrancyStatus = 1; _; _reentrancyStatus = 0;
    }

    enum RoundStatus { PENDING, ACTIVE, CASHED_OUT, LOST, REFUNDED }

    struct Round {
        address     player;
        uint256     stake;
        uint256     deckSeed;
        uint256     vrfRequestId;
        RoundStatus status;
        uint256     multiplier100; // final multiplier ×100
        uint256     netPayout;
        uint64      createdAt;
        uint64      settledAt;
        bool        custodial;   // MUST be last — storage layout safety for upgrades
    }

    mapping(bytes32 => Round)   public rounds;
    mapping(uint256 => bytes32) public vrfToRound;
    mapping(address => bytes32) public activeRound;

    event RoundStarted(bytes32 indexed roundId, address indexed player, uint256 stake, uint256 vrfRequestId);
    event RoundActive(bytes32 indexed roundId, uint256 deckSeed);
    event RoundCashedOut(bytes32 indexed roundId, address indexed player, uint256 multiplier100, uint256 netPayout, uint256 fee);
    event RoundLost(bytes32 indexed roundId, address indexed player, uint256 stepIndex);
    event RoundRefunded(bytes32 indexed roundId, address indexed player);

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
        maxMultiplier100 = 1_000_000; // 10000× cap
    }

    // ── Round lifecycle ────────────────────────────────────────────────────────

    function startRound(uint256 stake)
        external whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(stake >= minStake && stake <= maxStake, "stake out of range");
        require(activeRound[msg.sender] == bytes32(0), "active round exists");

        uint256 maxGross = (stake * maxMultiplier100) / 100;
        require(treasury.canPay(maxGross), "house insolvent");

        roundId = keccak256(abi.encodePacked("hilo", msg.sender, block.timestamp, stake));

        rounds[roundId] = Round({
            player:       msg.sender,
            stake:        stake,
            deckSeed:     0,
            vrfRequestId: 0,
            status:       RoundStatus.PENDING,
            multiplier100: 0,
            netPayout:    0,
            createdAt:    uint64(block.timestamp),
            settledAt:    0,
            custodial:    false
        });
        activeRound[msg.sender] = roundId;

        treasury.lockStake(GAME_ID, roundId, msg.sender, stake);
        uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
        rounds[roundId].vrfRequestId = vrfId;
        vrfToRound[vrfId] = roundId;

        emit RoundStarted(roundId, msg.sender, stake, vrfId);
    }

    /// @notice Custodial version — house wallet starts round on behalf of player.
    ///         No treasury.lockStake() — player balance managed in DB.
    function startRoundFor(address player, uint256 stake)
        external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(stake > 0, "zero stake");
        require(activeRound[player] == bytes32(0), "active round exists");

        roundId = keccak256(abi.encodePacked("hilo_custodial", player, block.timestamp, stake));

        rounds[roundId] = Round({
            player:       player,
            stake:        stake,
            deckSeed:     0,
            vrfRequestId: 0,
            status:       RoundStatus.PENDING,
            multiplier100: 0,
            netPayout:    0,
            createdAt:    uint64(block.timestamp),
            settledAt:    0,
            custodial:    true
        });
        activeRound[player] = roundId;

        uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
        rounds[roundId].vrfRequestId = vrfId;
        vrfToRound[vrfId] = roundId;

        emit RoundStarted(roundId, player, stake, vrfId);
    }

    function fulfillRandomness(uint256 vrfRequestId, uint256[] memory randomWords) external override {
        require(msg.sender == address(randomness), "only coordinator");

        bytes32 roundId = vrfToRound[vrfRequestId];
        Round storage r = rounds[roundId];
        require(r.status == RoundStatus.PENDING, "not pending");

        r.deckSeed = randomWords[0];
        r.status   = RoundStatus.ACTIVE;

        emit RoundActive(roundId, r.deckSeed);
    }

    // ── Cashout ───────────────────────────────────────────────────────────────

    /// @notice Cash out by providing the full card + guess history.
    ///         Contract verifies cards from deckSeed and replays guess logic.
    ///
    /// @param cards      All cards in revealed order (starting card + each drawn card)
    ///                   cards[0] = starting card; cards[i] = card revealed at step i
    /// @param positions  Deck position for each card (verified against deckSeed shuffle)
    /// @param guesses    Guesses made by player: 0=HIGHER, 1=LOWER, 2=SAME
    ///                   guesses[i] = guess made BEFORE card[i+1] was revealed
    ///                   Length = cards.length - 1 (one guess per transition)
    /// @param cashoutAt  How many CORRECT guesses to count before cashout (0 = after all)
    function cashout(
        bytes32 roundId,
        uint8[] calldata cards,
        uint8[] calldata positions,
        uint8[] calldata guesses,
        uint256 cashoutAt
    ) external nonReentrant {
        Round storage r = rounds[roundId];
        require(r.player == msg.sender || hasRole(OPERATOR_ROLE, msg.sender), "not authorized");
        require(r.status == RoundStatus.ACTIVE, "not active");
        require(cards.length >= 2, "need at least 2 cards");
        require(cards.length == positions.length, "position mismatch");
        require(guesses.length == cards.length - 1, "guess count mismatch");

        // Derive deck from seed
        uint8[52] memory deck = _shuffleDeck(r.deckSeed);

        // Verify all cards match deck positions
        for (uint256 i = 0; i < cards.length; i++) {
            require(positions[i] < 52, "position out of range");
            require(deck[positions[i]] == cards[i], "card mismatch");
        }

        // Replay guesses and compute multiplier
        uint256 cumMult100 = 100; // start at 1.00×
        uint256 correctGuesses = 0;

        for (uint256 i = 0; i < guesses.length; i++) {
            uint8 currentRank = _hiloRank(cards[i]);
            uint8 nextRank    = _hiloRank(cards[i + 1]);
            uint8 guess       = guesses[i];

            bool correct = _evaluateGuess(currentRank, nextRank, guess);
            if (!correct) {
                require(cashoutAt <= correctGuesses, "cashout past correct streak");
                break;
            }

            correctGuesses++;
            uint256 stepMult100 = GameMath.hiloMultiplierStep100(currentRank, guess);
            cumMult100 = (cumMult100 * stepMult100) / 100;
            if (cumMult100 > maxMultiplier100) cumMult100 = maxMultiplier100;

            if (cashoutAt > 0 && correctGuesses == cashoutAt) break;
        }

        r.status        = RoundStatus.CASHED_OUT;
        r.multiplier100 = cumMult100;
        r.settledAt     = uint64(block.timestamp);
        activeRound[r.player] = bytes32(0);

        uint256 gross = (r.stake * cumMult100) / 100;
        GameMath.Settlement memory s = GameMath.settle(r.stake, gross);
        r.netPayout = s.netPayout;

        if (!r.custodial) {
            treasury.payout(GAME_ID, roundId, r.player, s.netPayout, s.feeAmount);
        }
        emit RoundCashedOut(roundId, r.player, cumMult100, r.netPayout, s.feeAmount);
    }

    /// @notice Lose the round (wrong guess path). Callable by player or operator.
    function loseRound(
        bytes32 roundId,
        uint8[] calldata cards,
        uint8[] calldata positions,
        uint8[] calldata guesses,
        uint256 lostAtStep
    ) external nonReentrant {
        Round storage r = rounds[roundId];
        require(r.player == msg.sender || hasRole(OPERATOR_ROLE, msg.sender), "not authorized");
        require(r.status == RoundStatus.ACTIVE, "not active");
        require(cards.length >= lostAtStep + 2, "not enough cards");
        require(cards.length == positions.length, "position mismatch");
        require(lostAtStep < guesses.length, "invalid step");

        uint8[52] memory deck = _shuffleDeck(r.deckSeed);

        for (uint256 i = 0; i <= lostAtStep + 1; i++) {
            require(positions[i] < 52, "position out of range");
            require(deck[positions[i]] == cards[i], "card mismatch");
        }

        uint8 currentRank = _hiloRank(cards[lostAtStep]);
        uint8 nextRank    = _hiloRank(cards[lostAtStep + 1]);
        require(!_evaluateGuess(currentRank, nextRank, guesses[lostAtStep]), "guess was correct");

        r.status    = RoundStatus.LOST;
        r.settledAt = uint64(block.timestamp);
        activeRound[r.player] = bytes32(0);

        if (!r.custodial) {
            treasury.refundLoss(GAME_ID, roundId, r.player, r.stake);
        }

        emit RoundLost(roundId, r.player, lostAtStep);
    }

    function refundPending(bytes32 roundId) external onlyRole(OPERATOR_ROLE) nonReentrant {
        Round storage r = rounds[roundId];
        require(r.status == RoundStatus.PENDING, "not pending");
        require(block.timestamp > r.createdAt + 1 hours, "too early");

        r.status    = RoundStatus.REFUNDED;
        r.settledAt = uint64(block.timestamp);
        activeRound[r.player] = bytes32(0);

        if (!r.custodial) {
            treasury.cancelRefund(GAME_ID, roundId, r.player, r.stake);
        }
        emit RoundRefunded(roundId, r.player);
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _shuffleDeck(uint256 seed) internal pure returns (uint8[52] memory deck) {
        for (uint8 i = 0; i < 52; i++) deck[i] = i;
        for (uint8 i = 51; i > 0; i--) {
            uint8 j = uint8(uint256(keccak256(abi.encodePacked(seed, i))) % (uint256(i) + 1));
            (deck[i], deck[j]) = (deck[j], deck[i]);
        }
    }

    /// @notice Hi-Lo rank matching TypeScript hiloCardFromIndex convention:
    ///         card % 13 → 0=Two(1), 1=Three(2), ..., 11=King(12), 12=Ace(13, highest)
    function _hiloRank(uint8 card) internal pure returns (uint8) {
        uint8 rank = card % 13; // 0=Two, 1=Three, ..., 11=King, 12=Ace
        return rank + 1;        // Two=1, Three=2, ..., King=12, Ace=13
    }

    function _evaluateGuess(uint8 currentRank, uint8 nextRank, uint8 guess) internal pure returns (bool) {
        if (guess == 0) return nextRank > currentRank;  // HIGHER
        if (guess == 1) return nextRank < currentRank;  // LOWER
        if (guess == 2) return nextRank == currentRank; // SAME
        return false;
    }

    // ── Views ──────────────────────────────────────────────────────────────────

    function getDeckOrder(bytes32 roundId) external view returns (uint8[52] memory) {
        Round storage r = rounds[roundId];
        require(r.status != RoundStatus.PENDING, "seed not available yet");
        return _shuffleDeck(r.deckSeed);
    }

    function getRound(bytes32 roundId) external view returns (Round memory) { return rounds[roundId]; }
    function gameName() external pure override returns (string memory) { return "HiLo"; }
    function gameId()   external pure override returns (bytes32)       { return GAME_ID; }

    function setLimits(uint256 min_, uint256 max_, uint256 maxMult_) external onlyRole(OPERATOR_ROLE) {
        minStake = min_; maxStake = max_; maxMultiplier100 = maxMult_;
    }
    function pause()   external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
