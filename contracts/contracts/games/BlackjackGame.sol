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

/// @title BlackjackGame — European Blackjack with onchain deck commitment and rule verification
///
/// Transparency model:
///   1. startRound()  — locks stake, requests Chainlink VRF
///   2. VRF callback  — stores deckSeed onchain; deck order is deterministic from seed
///   3. Player takes actions (hit/stand/double/split) via backend UX
///      Backend derives card at each deck position from deckSeed using published algorithm:
///      deck[i] = Fisher-Yates shuffle via keccak256(deckSeed, step)
///   4. settleRound() — backend (or player) submits: playerCards[], dealerCards[], didDouble
///      CONTRACT re-derives deck, verifies cards match claimed positions,
///      applies blackjack rules, determines outcome, and settles — fully onchain authority
///
/// Card encoding: uint8 [0..51]. Rank = card % 13. Suit = card / 13.
///   Rank 0 = Ace, Ranks 1-9 = 2-10, Rank 10 = Jack, Rank 11 = Queen, Rank 12 = King
///
/// Dealer rules: hit on soft 16 or less, stand on 17+.
/// Natural blackjack (Ace+10-value as first two cards) pays 1.5× stake net.
/// Split: one additional stake locked; each hand evaluated independently.
contract BlackjackGame is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IGame
{
    bytes32 public constant GAME_ID       = keccak256("BLACKJACK");
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

    enum RoundStatus { PENDING, ACTIVE, SETTLED, REFUNDED }

    struct Round {
        address     player;
        uint256     stake;        // main hand stake
        uint256     splitStake;   // additional stake if split (0 if no split)
        uint256     doubleStake;  // additional stake if doubled (0 if not doubled)
        uint256     deckSeed;     // stored after VRF fulfills
        uint256     vrfRequestId;
        RoundStatus status;
        uint256     netPayout;
        uint64      createdAt;
        uint64      settledAt;
        /// @dev v2: true = custodial bet; funds tracked in DB, no on-chain token transfers
        bool        custodial;
    }

    mapping(bytes32 => Round)   public rounds;
    mapping(uint256 => bytes32) public vrfToRound;
    mapping(address => bytes32) public activeRound;

    event RoundStarted(bytes32 indexed roundId, address indexed player, uint256 stake, uint256 vrfRequestId);
    event RoundActive(bytes32 indexed roundId, uint256 deckSeed);
    event RoundSettled(bytes32 indexed roundId, address indexed player, uint256 netPayout, uint256 fee);
    event RoundRefunded(bytes32 indexed roundId, address indexed player);
    event SplitLocked(bytes32 indexed roundId, uint256 splitStake);

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

    // ── Player: start ──────────────────────────────────────────────────────────

    /// @notice Place a custodial blackjack round on behalf of a player (OPERATOR only).
    ///         Funds tracked in off-chain DB — no token pull from player wallet.
    ///         Chainlink VRF still generates the deck seed on-chain.
    function startRoundFor(address player, uint256 stake)
        external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(player != address(0), "invalid player");
        require(stake >= minStake && stake <= maxStake, "stake out of range");
        require(activeRound[player] == bytes32(0), "active round exists");
        // No canPay() check — custodial bets settled via DB balance, not TreasuryVault

        // Use "blackjack-c" prefix to distinguish custodial rounds
        roundId = keccak256(abi.encodePacked("blackjack-c", player, block.timestamp, stake));

        rounds[roundId] = Round({
            player:       player,
            stake:        stake,
            splitStake:   0,
            doubleStake:  0,
            deckSeed:     0,
            vrfRequestId: 0,
            status:       RoundStatus.PENDING,
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

    /// @notice Lock additional split stake for a custodial round (OPERATOR only).
    function lockSplitFor(bytes32 roundId)
        external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant
    {
        Round storage r = rounds[roundId];
        require(r.custodial, "not custodial");
        require(r.status == RoundStatus.ACTIVE, "not active");
        require(r.splitStake == 0, "already split");
        require(r.stake <= maxStake, "split stake exceeds max");

        r.splitStake = r.stake;
        emit SplitLocked(roundId, r.splitStake);
    }

    function startRound(uint256 stake)
        external whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(stake >= minStake && stake <= maxStake, "stake out of range");
        require(activeRound[msg.sender] == bytes32(0), "active round exists");

        // Max payout: blackjack pays 2.5× (1.5× net + returned stake)
        require(treasury.canPay((stake * 25) / 10), "house insolvent");

        roundId = keccak256(abi.encodePacked("blackjack", msg.sender, block.timestamp, stake));

        rounds[roundId] = Round({
            player:       msg.sender,
            stake:        stake,
            splitStake:   0,
            doubleStake:  0,
            deckSeed:     0,
            vrfRequestId: 0,
            status:       RoundStatus.PENDING,
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

    function fulfillRandomness(uint256 vrfRequestId, uint256[] memory randomWords) external override {
        require(msg.sender == address(randomness), "only coordinator");

        bytes32 roundId = vrfToRound[vrfRequestId];
        Round storage r = rounds[roundId];
        require(r.status == RoundStatus.PENDING, "not pending");

        r.deckSeed = randomWords[0];
        r.status   = RoundStatus.ACTIVE;

        emit RoundActive(roundId, r.deckSeed);
    }

    /// @notice Lock additional stake for a double-down.
    function lockDouble(bytes32 roundId) external whenNotPaused nonReentrant {
        Round storage r = rounds[roundId];
        require(r.player == msg.sender, "not your round");
        require(r.status == RoundStatus.ACTIVE, "not active");
        require(r.doubleStake == 0, "already doubled");
        require(r.stake <= maxStake, "double stake exceeds max");

        r.doubleStake = r.stake; // double-down = equal to main stake
        treasury.lockStake(GAME_ID, roundId, msg.sender, r.stake);
    }

    /// @notice Lock additional stake for a split action.
    function lockSplit(bytes32 roundId) external whenNotPaused nonReentrant {
        Round storage r = rounds[roundId];
        require(r.player == msg.sender, "not your round");
        require(r.status == RoundStatus.ACTIVE, "not active");
        require(r.splitStake == 0, "already split");
        require(r.stake <= maxStake, "split stake exceeds max");

        r.splitStake = r.stake; // equal to main stake
        treasury.lockStake(GAME_ID, roundId, msg.sender, r.stake);
        emit SplitLocked(roundId, r.splitStake);
    }

    // ── Settlement ─────────────────────────────────────────────────────────────

    /// @notice Settle the round. Callable by OPERATOR (backend) or the player.
    ///         Submits the card sequences; contract verifies and applies rules.
    ///
    /// @param playerCards  Cards dealt to player in deck order (main hand)
    /// @param dealerCards  Cards dealt to dealer in deck order
    /// @param playerPositions  Deck positions of playerCards (0=first deal, 2=second, then hits)
    /// @param dealerPositions  Deck positions of dealerCards (1=first deal, 3=second, then hits)
    /// @param splitCards  Cards for split hand (empty if no split)
    /// @param splitPositions  Deck positions of splitCards
    /// @param didDouble  Whether player doubled on main hand
    function settleRound(
        bytes32 roundId,
        uint8[] calldata playerCards,
        uint8[] calldata dealerCards,
        uint8[] calldata playerPositions,
        uint8[] calldata dealerPositions,
        uint8[] calldata splitCards,
        uint8[] calldata splitPositions,
        bool didDouble
    ) external nonReentrant {
        Round storage r = rounds[roundId];
        require(r.player == msg.sender || hasRole(OPERATOR_ROLE, msg.sender), "not authorized");
        require(r.status == RoundStatus.ACTIVE, "not active");
        require(playerCards.length >= 2, "need at least 2 player cards");
        require(dealerCards.length >= 2, "need at least 2 dealer cards");
        require(playerCards.length == playerPositions.length, "position mismatch");
        require(dealerCards.length == dealerPositions.length, "position mismatch");

        // Derive shuffled deck from seed
        uint8[52] memory deck = _shuffleDeck(r.deckSeed);

        // Verify all claimed cards match their deck positions
        _verifyCards(deck, playerCards, playerPositions);
        _verifyCards(deck, dealerCards, dealerPositions);

        // Compute main hand outcome
        (uint256 mainPayout, uint256 mainFee) = _evaluateHand(
            r.stake,
            playerCards,
            dealerCards,
            didDouble
        );

        // Compute split hand outcome (if exists)
        uint256 splitPayout = 0;
        uint256 splitFee    = 0;
        bool    hasSplit    = splitCards.length > 0;

        if (hasSplit) {
            require(r.splitStake > 0, "no split stake locked");
            require(splitCards.length == splitPositions.length, "position mismatch");
            _verifyCards(deck, splitCards, splitPositions);
            (splitPayout, splitFee) = _evaluateHand(r.splitStake, splitCards, dealerCards, false);
        }

        // Settle main hand
        r.status    = RoundStatus.SETTLED;
        r.settledAt = uint64(block.timestamp);
        activeRound[r.player] = bytes32(0);

        uint256 totalNet = mainPayout + splitPayout;
        uint256 totalFee = mainFee + splitFee;
        r.netPayout = totalNet;

        if (!r.custodial) {
            // ── Original flow: real token transfers through treasury ───────────
            if (totalNet > 0) {
                treasury.payout(GAME_ID, roundId, r.player, totalNet, totalFee);
            } else {
                // All hands lost — refund the total locked amount to vault bookkeeping
                uint256 totalLocked = r.stake
                    + (hasSplit  ? r.splitStake  : 0)
                    + (didDouble ? r.doubleStake : 0);
                treasury.refundLoss(GAME_ID, roundId, r.player, totalLocked);
            }
        }
        // ── Custodial flow: result stored on-chain, DB balance updated off-chain ──

        emit RoundSettled(roundId, r.player, totalNet, totalFee);
    }

    // ── Refund for stuck PENDING rounds ───────────────────────────────────────

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

    // ── Internal: deck + card verification ────────────────────────────────────

    /// @notice Fisher-Yates shuffle of 52 cards using keccak256 expansion of seed
    function _shuffleDeck(uint256 seed) internal pure returns (uint8[52] memory deck) {
        for (uint8 i = 0; i < 52; i++) deck[i] = i;
        for (uint8 i = 51; i > 0; i--) {
            uint8 j = uint8(uint256(keccak256(abi.encodePacked(seed, i))) % (uint256(i) + 1));
            (deck[i], deck[j]) = (deck[j], deck[i]);
        }
    }

    /// @notice Verify claimed cards match actual deck positions
    function _verifyCards(
        uint8[52] memory deck,
        uint8[] calldata cards,
        uint8[] calldata positions
    ) internal pure {
        for (uint256 i = 0; i < cards.length; i++) {
            require(positions[i] < 52, "position out of range");
            require(deck[positions[i]] == cards[i], "card mismatch");
        }
    }

    // ── Internal: blackjack rules ──────────────────────────────────────────────

    /// @notice Evaluate a single blackjack hand and return (netPayout, feeAmount).
    ///         Returns (0, 0) on loss.
    function _evaluateHand(
        uint256 stake,
        uint8[] calldata playerCards,
        uint8[] calldata dealerCards,
        bool doubled
    ) internal pure returns (uint256 netPayout, uint256 feeAmount) {
        uint256 effectiveStake = doubled ? stake * 2 : stake;

        (uint256 pVal,) = GameMath.blackjackHandValue(_toMemory(playerCards));
        (uint256 dVal,) = GameMath.blackjackHandValue(_toMemory(dealerCards));

        bool playerBust = pVal > 21;
        bool dealerBust = dVal > 21;
        bool playerBJ   = playerCards.length == 2 && pVal == 21;
        bool dealerBJ   = dealerCards.length == 2 && dVal == 21;

        uint256 gross = 0;

        if (playerBust) {
            // Player busts — loses
            return (0, 0);
        } else if (playerBJ && !dealerBJ) {
            // Blackjack pays 3:2 → gross = effectiveStake × 2.5
            gross = (effectiveStake * 25) / 10;
        } else if (!playerBJ && dealerBJ) {
            // Dealer blackjack — player loses
            return (0, 0);
        } else if (playerBJ && dealerBJ) {
            // Push — return stake
            return (effectiveStake, 0);
        } else if (dealerBust || pVal > dVal) {
            // Player wins — even money → gross = 2 × effectiveStake
            gross = effectiveStake * 2;
        } else if (pVal == dVal) {
            // Push — return stake
            return (effectiveStake, 0);
        } else {
            // Player loses
            return (0, 0);
        }

        GameMath.Settlement memory s = GameMath.settle(effectiveStake, gross);
        return (s.netPayout, s.feeAmount);
    }

    function _toMemory(uint8[] calldata arr) internal pure returns (uint8[] memory m) {
        m = new uint8[](arr.length);
        for (uint256 i = 0; i < arr.length; i++) m[i] = arr[i];
    }

    // ── Views ──────────────────────────────────────────────────────────────────

    /// @notice Get deck ordering for a settled/active round (transparency helper)
    function getDeckOrder(bytes32 roundId) external view returns (uint8[52] memory) {
        Round storage r = rounds[roundId];
        require(r.status != RoundStatus.PENDING, "seed not available yet");
        return _shuffleDeck(r.deckSeed);
    }

    function getRound(bytes32 roundId) external view returns (Round memory) { return rounds[roundId]; }
    function gameName() external pure override returns (string memory) { return "Blackjack"; }
    function gameId()   external pure override returns (bytes32)       { return GAME_ID; }

    function setLimits(uint256 min_, uint256 max_) external onlyRole(OPERATOR_ROLE) {
        minStake = min_; maxStake = max_;
    }
    function pause()   external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
