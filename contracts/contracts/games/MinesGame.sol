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

/// @title MinesGame — 5×5 Mines with full onchain transparency
///
/// Transparency model:
///   1. startRound()  — locks stake, requests Chainlink VRF
///   2. VRF callback  — stores vrfSeed onchain; backend derives mine positions
///                      using the same Fisher-Yates algorithm (publicly auditable)
///   3. Player reveals tiles via the backend UX; backend validates each reveal
///      using the onchain vrfSeed (it cannot lie — anyone can re-derive)
///   4. cashout()     — player submits their safe tile list; CONTRACT re-derives
///                      mine positions and VERIFIES no mine was revealed,
///                      computes multiplier, and settles — fully onchain authority
///   5. loseRound()   — callable by player OR backend; CONTRACT verifies the
///                      losing tile IS a mine, then absorbs stake
///
/// The backend is NOT the financial authority — the contract is.
/// Mine positions are deterministically reproducible from the onchain vrfSeed.
///
/// Mine derivation algorithm (matches TS backend):
///   tiles = [0..24]; Fisher-Yates using keccak256(vrfSeed, step) as RNG
///   mines = first mineCount elements of shuffled array
contract MinesGame is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IGame
{
    bytes32 public constant GAME_ID       = keccak256("MINES");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint8 public constant BOARD_SIZE = 25; // 5×5

    TreasuryVault         public treasury;
    RandomnessCoordinator public randomness;
    uint256 public minStake;
    uint256 public maxStake;
    uint256 public maxMines; // max mine count (default 24)

    uint256 private _reentrancyStatus;
    modifier nonReentrant() {
        require(_reentrancyStatus == 0, "reentrant");
        _reentrancyStatus = 1; _; _reentrancyStatus = 0;
    }

    enum RoundStatus { PENDING, ACTIVE, CASHED_OUT, LOST, REFUNDED }

    struct Round {
        address     player;
        uint256     stake;
        uint8       mineCount;
        uint256     vrfSeed;        // stored after VRF fulfills (board entropy)
        uint256     vrfRequestId;
        RoundStatus status;
        uint256     safePicks;      // number of safe tiles revealed (set at cashout)
        uint256     multiplier100;  // final multiplier ×100
        uint256     netPayout;
        uint64      createdAt;
        uint64      settledAt;
        /// @dev v2: true = custodial bet; funds tracked in DB, no on-chain token transfers
        bool        custodial;
    }

    mapping(bytes32 => Round)   public rounds;
    mapping(uint256 => bytes32) public vrfToRound;
    // Track active round per player (one at a time)
    mapping(address => bytes32) public activeRound;

    event RoundStarted(bytes32 indexed roundId, address indexed player, uint256 stake, uint8 mineCount, uint256 vrfRequestId);
    event RoundActive(bytes32 indexed roundId, uint256 vrfSeed); // emitted when VRF fulfills
    event RoundCashedOut(bytes32 indexed roundId, address indexed player, uint256 safePicks, uint256 multiplier100, uint256 netPayout, uint256 fee);
    event RoundLost(bytes32 indexed roundId, address indexed player, uint8 hitTile);
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
        treasury  = TreasuryVault(treasury_);
        randomness = RandomnessCoordinator(randomness_);
        minStake  = min_;
        maxStake  = max_;
        maxMines  = 24;
    }

    // ── Player actions ─────────────────────────────────────────────────────────

    /// @notice Start a new Mines round. One active round per player.
    function startRound(uint256 stake, uint8 mineCount)
        external whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(stake >= minStake && stake <= maxStake, "stake out of range");
        require(mineCount >= 1 && mineCount <= maxMines, "invalid mine count");
        require(activeRound[msg.sender] == bytes32(0), "active round exists");

        // Solvency check: worst case = all safe tiles revealed
        uint256 maxMult = GameMath.minesMultiplier100(BOARD_SIZE, mineCount, BOARD_SIZE - mineCount);
        uint256 maxGross = (stake * maxMult) / 100;
        require(treasury.canPay(maxGross), "house insolvent");

        roundId = keccak256(abi.encodePacked("mines", msg.sender, block.timestamp, stake, mineCount));

        rounds[roundId] = Round({
            player:       msg.sender,
            stake:        stake,
            mineCount:    mineCount,
            vrfSeed:      0,
            vrfRequestId: 0,
            status:       RoundStatus.PENDING,
            safePicks:    0,
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

        emit RoundStarted(roundId, msg.sender, stake, mineCount, vrfId);
    }

    /// @notice Called by Chainlink VRF coordinator via RandomnessCoordinator
    function fulfillRandomness(uint256 vrfRequestId, uint256[] memory randomWords) external override {
        require(msg.sender == address(randomness), "only coordinator");

        bytes32 roundId = vrfToRound[vrfRequestId];
        Round storage r = rounds[roundId];
        require(r.status == RoundStatus.PENDING, "not pending");

        r.vrfSeed = randomWords[0];
        r.status  = RoundStatus.ACTIVE;

        emit RoundActive(roundId, r.vrfSeed);
    }

    /// @notice Player cashes out by providing the list of safe tiles they revealed.
    ///         Contract verifies none are mines and computes the payout.
    /// @param revealedTiles Array of tile indices [0..24] the player revealed safely
    function cashout(bytes32 roundId, uint8[] calldata revealedTiles) external nonReentrant {
        Round storage r = rounds[roundId];
        require(r.player == msg.sender, "not your round");
        require(r.status == RoundStatus.ACTIVE, "not active");
        require(revealedTiles.length > 0, "no tiles revealed");
        require(revealedTiles.length <= BOARD_SIZE - r.mineCount, "too many tiles");

        // Derive mine map from vrfSeed — fully onchain verification
        bool[BOARD_SIZE] memory mineMap = _deriveMineMap(r.vrfSeed, r.mineCount);

        // Verify no duplicates and no mines in revealed tiles
        bool[BOARD_SIZE] memory seen;
        for (uint256 i = 0; i < revealedTiles.length; i++) {
            uint8 tile = revealedTiles[i];
            require(tile < BOARD_SIZE, "tile out of range");
            require(!seen[tile], "duplicate tile");
            require(!mineMap[tile], "tile is a mine");
            seen[tile] = true;
        }

        r.status      = RoundStatus.CASHED_OUT;
        r.safePicks   = revealedTiles.length;
        r.multiplier100 = GameMath.minesMultiplier100(BOARD_SIZE, r.mineCount, r.safePicks);
        r.settledAt   = uint64(block.timestamp);
        activeRound[msg.sender] = bytes32(0);

        uint256 gross = (r.stake * r.multiplier100) / 100;
        GameMath.Settlement memory s = GameMath.settle(r.stake, gross);
        r.netPayout = s.netPayout;

        treasury.payout(GAME_ID, roundId, r.player, s.netPayout, s.feeAmount);

        emit RoundCashedOut(roundId, r.player, r.safePicks, r.multiplier100, r.netPayout, s.feeAmount);
    }

    /// @notice Record a loss when a mine was hit.
    ///         Callable by player or OPERATOR (backend relay).
    ///         Contract verifies hitTile IS a mine before absorbing the stake.
    function loseRound(bytes32 roundId, uint8 hitTile) external nonReentrant {
        Round storage r = rounds[roundId];
        require(r.player == msg.sender || hasRole(OPERATOR_ROLE, msg.sender), "not authorized");
        require(r.status == RoundStatus.ACTIVE, "not active");
        require(hitTile < BOARD_SIZE, "tile out of range");

        // Verify the tile IS a mine — contract is the authority
        bool[BOARD_SIZE] memory mineMap = _deriveMineMap(r.vrfSeed, r.mineCount);
        require(mineMap[hitTile], "not a mine");

        r.status    = RoundStatus.LOST;
        r.settledAt = uint64(block.timestamp);
        activeRound[r.player] = bytes32(0);

        // Stake absorbed by vault bankroll
        treasury.refundLoss(GAME_ID, roundId, r.player, r.stake);

        emit RoundLost(roundId, r.player, hitTile);
    }

    // ── Custodial operator actions ──────────────────────────────────────────────

    /// @notice Start a custodial Mines round on behalf of a player (OPERATOR only).
    ///         Funds tracked in off-chain DB — no token pull from player wallet.
    ///         Chainlink VRF still provides the vrfSeed for mine derivation.
    function startRoundFor(address player, uint256 stake, uint8 mineCount)
        external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant returns (bytes32 roundId)
    {
        require(player != address(0), "invalid player");
        require(stake >= minStake && stake <= maxStake, "stake out of range");
        require(mineCount >= 1 && mineCount <= maxMines, "invalid mine count");
        require(activeRound[player] == bytes32(0), "active round exists");

        // Use "mines-c" prefix to distinguish custodial rounds
        roundId = keccak256(abi.encodePacked("mines-c", player, block.timestamp, stake, mineCount));

        rounds[roundId] = Round({
            player:        player,
            stake:         stake,
            mineCount:     mineCount,
            vrfSeed:       0,
            vrfRequestId:  0,
            status:        RoundStatus.PENDING,
            safePicks:     0,
            multiplier100: 0,
            netPayout:     0,
            createdAt:     uint64(block.timestamp),
            settledAt:     0,
            custodial:     true
        });
        activeRound[player] = roundId;

        uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
        rounds[roundId].vrfRequestId = vrfId;
        vrfToRound[vrfId] = roundId;

        emit RoundStarted(roundId, player, stake, mineCount, vrfId);
    }

    /// @notice Cash out a custodial round (OPERATOR only).
    ///         Verifies none of the revealed tiles are mines, computes payout.
    ///         DB balance updated off-chain by backend after this call confirms.
    function cashoutFor(bytes32 roundId, uint8[] calldata revealedTiles)
        external onlyRole(OPERATOR_ROLE) nonReentrant
    {
        Round storage r = rounds[roundId];
        require(r.custodial, "not custodial");
        require(r.status == RoundStatus.ACTIVE, "not active");
        require(revealedTiles.length > 0, "no tiles revealed");
        require(revealedTiles.length <= BOARD_SIZE - r.mineCount, "too many tiles");

        bool[BOARD_SIZE] memory mineMap = _deriveMineMap(r.vrfSeed, r.mineCount);
        bool[BOARD_SIZE] memory seen;
        for (uint256 i = 0; i < revealedTiles.length; i++) {
            uint8 tile = revealedTiles[i];
            require(tile < BOARD_SIZE, "tile out of range");
            require(!seen[tile], "duplicate tile");
            require(!mineMap[tile], "tile is a mine");
            seen[tile] = true;
        }

        r.status        = RoundStatus.CASHED_OUT;
        r.safePicks     = revealedTiles.length;
        r.multiplier100 = GameMath.minesMultiplier100(BOARD_SIZE, r.mineCount, r.safePicks);
        r.settledAt     = uint64(block.timestamp);
        activeRound[r.player] = bytes32(0);

        uint256 gross = (r.stake * r.multiplier100) / 100;
        GameMath.Settlement memory s = GameMath.settle(r.stake, gross);
        r.netPayout = s.netPayout;

        // No treasury.payout() — custodial payout handled off-chain via DB
        emit RoundCashedOut(roundId, r.player, r.safePicks, r.multiplier100, r.netPayout, s.feeAmount);
    }

    /// @notice Record a mine-hit loss for a custodial round (OPERATOR only).
    ///         Contract verifies hitTile IS a mine before recording the loss.
    function loseRoundFor(bytes32 roundId, uint8 hitTile)
        external onlyRole(OPERATOR_ROLE) nonReentrant
    {
        Round storage r = rounds[roundId];
        require(r.custodial, "not custodial");
        require(r.status == RoundStatus.ACTIVE, "not active");
        require(hitTile < BOARD_SIZE, "tile out of range");

        bool[BOARD_SIZE] memory mineMap = _deriveMineMap(r.vrfSeed, r.mineCount);
        require(mineMap[hitTile], "not a mine");

        r.status    = RoundStatus.LOST;
        r.settledAt = uint64(block.timestamp);
        activeRound[r.player] = bytes32(0);

        // No treasury.refundLoss() — stake already debited from DB
        emit RoundLost(roundId, r.player, hitTile);
    }

    /// @notice Refund a round stuck in PENDING (VRF never fulfilled) — admin only.
    function refundPending(bytes32 roundId) external onlyRole(OPERATOR_ROLE) nonReentrant {
        Round storage r = rounds[roundId];
        require(r.status == RoundStatus.PENDING, "not pending");
        require(block.timestamp > r.createdAt + 1 hours, "too early to refund");

        r.status    = RoundStatus.REFUNDED;
        r.settledAt = uint64(block.timestamp);
        activeRound[r.player] = bytes32(0);

        treasury.cancelRefund(GAME_ID, roundId, r.player, r.stake);
        emit RoundRefunded(roundId, r.player);
    }

    // ── Internal: mine derivation ──────────────────────────────────────────────

    /// @notice Derive mine positions using Fisher-Yates shuffle from vrfSeed.
    ///         Algorithm: tiles[0..24]; for i=24 downto 1: j=keccak(seed,i)%(i+1); swap
    ///         First mineCount tiles are mines.
    function _deriveMineMap(uint256 seed, uint8 mineCount)
        internal pure returns (bool[BOARD_SIZE] memory mineMap)
    {
        uint8[BOARD_SIZE] memory tiles;
        for (uint8 i = 0; i < BOARD_SIZE; i++) tiles[i] = i;

        for (uint8 i = BOARD_SIZE - 1; i > 0; i--) {
            uint8 j = uint8(uint256(keccak256(abi.encodePacked(seed, i))) % (uint256(i) + 1));
            (tiles[i], tiles[j]) = (tiles[j], tiles[i]);
        }

        for (uint8 k = 0; k < mineCount; k++) {
            mineMap[tiles[k]] = true;
        }
    }

    /// @notice Public helper to derive mine positions for verification/frontend display
    function getMinePositions(bytes32 roundId) external view returns (uint8[] memory positions) {
        Round storage r = rounds[roundId];
        require(r.status != RoundStatus.PENDING, "seed not available yet");
        bool[BOARD_SIZE] memory mineMap = _deriveMineMap(r.vrfSeed, r.mineCount);
        uint8 count = 0;
        for (uint8 i = 0; i < BOARD_SIZE; i++) { if (mineMap[i]) count++; }
        positions = new uint8[](count);
        uint8 idx = 0;
        for (uint8 i = 0; i < BOARD_SIZE; i++) { if (mineMap[i]) positions[idx++] = i; }
    }

    function getRound(bytes32 roundId) external view returns (Round memory) { return rounds[roundId]; }
    function gameName() external pure override returns (string memory) { return "Mines"; }
    function gameId()   external pure override returns (bytes32)       { return GAME_ID; }

    function setLimits(uint256 min_, uint256 max_, uint256 maxM) external onlyRole(OPERATOR_ROLE) {
        minStake = min_; maxStake = max_; maxMines = maxM;
    }
    function pause()   external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
