// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title TreasuryVault — holds all GZO in escrow, pays winners
/// @notice Games call lockStake / payout / refundLoss; never interact with token directly
/// @dev v2: proper totalLocked tracking; payout checks vault balance not lockedByGame
contract TreasuryVault is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ── Inline reentrancy guard ────────────────────────────────────────────────
    uint256 private _reentrancyStatus;
    modifier nonReentrant() {
        require(_reentrancyStatus == 0, "ReentrancyGuard: reentrant call");
        _reentrancyStatus = 1;
        _;
        _reentrancyStatus = 0;
    }

    // ── Roles ──────────────────────────────────────────────────────────────────
    bytes32 public constant GAME_ROLE     = keccak256("GAME_ROLE");
    bytes32 public constant PAUSER_ROLE   = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant FEE_ROLE      = keccak256("FEE_ROLE");

    // ── Storage ────────────────────────────────────────────────────────────────
    IERC20 public gzoToken;
    uint256 public totalFeesAccrued;          // cumulative fees collected
    uint256 public totalLocked;               // sum of all currently locked stakes
    mapping(bytes32 => uint256) public lockedByGame; // per-game locked amount

    // ── Events ─────────────────────────────────────────────────────────────────
    event StakeLocked(bytes32 indexed gameId, address indexed player, uint256 amount, bytes32 indexed roundId);
    event PayoutSent(bytes32 indexed gameId, address indexed winner, uint256 netAmount, bytes32 indexed roundId);
    event FeeCollected(bytes32 indexed gameId, uint256 feeAmount, bytes32 indexed roundId);
    event StakeRefunded(bytes32 indexed gameId, address indexed player, uint256 amount, bytes32 indexed roundId);
    event BankrollDeposited(address indexed depositor, uint256 amount);
    event BankrollWithdrawn(address indexed to, uint256 amount);

    // ── Initializer ───────────────────────────────────────────────────────────
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address gzoToken_, address admin) external initializer {
        __AccessControl_init();
        __Pausable_init();
        gzoToken = IERC20(gzoToken_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE,   admin);
        _grantRole(UPGRADER_ROLE, admin);
        _grantRole(FEE_ROLE,      admin);
    }

    // ── Game-callable ──────────────────────────────────────────────────────────

    /// @notice Pull stake from player into vault. Player must have approved vault first.
    function lockStake(
        bytes32 gameId,
        bytes32 roundId,
        address player,
        uint256 amount
    ) external onlyRole(GAME_ROLE) whenNotPaused nonReentrant {
        require(amount > 0, "zero stake");
        gzoToken.safeTransferFrom(player, address(this), amount);
        lockedByGame[gameId] += amount;
        totalLocked += amount;
        emit StakeLocked(gameId, player, amount, roundId);
    }

    /// @notice Pay winner from vault. netAmount goes to winner; feeAmount stays as bankroll.
    /// @dev Checks vault has enough free balance. Releases the locked accounting for this round.
    function payout(
        bytes32 gameId,
        bytes32 roundId,
        address winner,
        uint256 netAmount,
        uint256 feeAmount
    ) external onlyRole(GAME_ROLE) whenNotPaused nonReentrant {
        require(
            gzoToken.balanceOf(address(this)) >= netAmount,
            "vault: insufficient balance"
        );
        // Release locked accounting (capped at what's tracked for this game)
        uint256 gross = netAmount + feeAmount;
        uint256 release = gross < lockedByGame[gameId] ? gross : lockedByGame[gameId];
        lockedByGame[gameId] -= release;
        if (release <= totalLocked) {
            totalLocked -= release;
        } else {
            totalLocked = 0;
        }
        totalFeesAccrued += feeAmount;
        if (netAmount > 0) gzoToken.safeTransfer(winner, netAmount);
        emit PayoutSent(gameId, winner, netAmount, roundId);
        if (feeAmount > 0) emit FeeCollected(gameId, feeAmount, roundId);
    }

    /// @notice Absorb a losing stake into vault bankroll (player loses, stake stays).
    function refundLoss(
        bytes32 gameId,
        bytes32 roundId,
        address player,
        uint256 amount
    ) external onlyRole(GAME_ROLE) whenNotPaused nonReentrant {
        require(lockedByGame[gameId] >= amount, "insufficient locked");
        lockedByGame[gameId] -= amount;
        totalLocked -= amount;
        // Losing stake stays in vault as bankroll — no transfer
        emit StakeRefunded(gameId, player, amount, roundId);
    }

    /// @notice Full refund to player (cancelled round / error path).
    function cancelRefund(
        bytes32 gameId,
        bytes32 roundId,
        address player,
        uint256 amount
    ) external onlyRole(GAME_ROLE) nonReentrant {
        require(lockedByGame[gameId] >= amount, "insufficient locked");
        lockedByGame[gameId] -= amount;
        totalLocked -= amount;
        gzoToken.safeTransfer(player, amount);
        emit StakeRefunded(gameId, player, amount, roundId);
    }

    // ── Admin ──────────────────────────────────────────────────────────────────

    function depositBankroll(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        gzoToken.safeTransferFrom(msg.sender, address(this), amount);
        emit BankrollDeposited(msg.sender, amount);
    }

    function withdrawBankroll(address to, uint256 amount) external onlyRole(FEE_ROLE) nonReentrant {
        uint256 freeBankroll = gzoToken.balanceOf(address(this));
        require(freeBankroll >= totalLocked + amount, "would undercollateralize");
        gzoToken.safeTransfer(to, amount);
        emit BankrollWithdrawn(to, amount);
    }

    /// @notice Solvency check: vault free balance can cover a new payout of `amount`
    function canPay(uint256 amount) external view returns (bool) {
        uint256 vaultBalance = gzoToken.balanceOf(address(this));
        return vaultBalance >= totalLocked + amount;
    }

    function pause()   external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
