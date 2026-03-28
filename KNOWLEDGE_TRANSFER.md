# Gamzo — Complete Knowledge Transfer Document

> **Audience:** Any engineer joining the project, auditors, or stakeholders who need a full
> understanding of how Gamzo works — from a user clicking "Place Bet" through to GZO tokens
> moving on-chain and history appearing in the UI.
>
> **Last updated:** 2026-03-18
> **Version:** Web3 hybrid (Polygon Amoy + local Hardhat)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Repository Structure](#4-repository-structure)
5. [GZO Token](#5-gzo-token)
6. [Token Flow — How GZO Moves](#6-token-flow--how-gzo-moves)
7. [Smart Contract Architecture](#7-smart-contract-architecture)
8. [Provably Fair RNG System](#8-provably-fair-rng-system)
9. [Settlement & Fee Model](#9-settlement--fee-model)
10. [Game-by-Game Reference](#10-game-by-game-reference)
    - [Coin Flip (PvP)](#coinflip--pvp)
    - [Dice](#dice)
    - [Plinko](#plinko)
    - [Keno](#keno)
    - [Mines](#mines)
    - [Roulette](#roulette)
    - [Blackjack](#blackjack)
    - [Hilo](#hilo)
    - [Wheel](#wheel)
11. [Authentication & User Identity](#11-authentication--user-identity)
12. [Database Schema](#12-database-schema)
13. [API Routes Reference](#13-api-routes-reference)
14. [Frontend Architecture](#14-frontend-architecture)
15. [Web3 Integration Layer](#15-web3-integration-layer)
16. [House Treasury & Accounting](#16-house-treasury--accounting)
17. [Security Model](#17-security-model)
18. [Local Development Setup](#18-local-development-setup)
19. [Polygon Amoy Deployment](#19-polygon-amoy-deployment)
20. [Adding a New Game](#20-adding-a-new-game)
21. [Upgrading Contracts](#21-upgrading-contracts)
22. [Testing Strategy](#22-testing-strategy)
23. [Environment Variables Reference](#23-environment-variables-reference)
24. [Glossary](#24-glossary)

---

## 1. Project Overview

**Gamzo** is a provably fair, onchain-settled casino gaming platform built on Polygon.

**Core promise to users:**
- Every bet outcome is generated using HMAC-SHA256 with a committed server seed, the player's
  own client seed, and a public nonce — producing a result that is mathematically impossible to
  manipulate after the bet is placed.
- On the web3 layer, all financial state (staking, settlement, payout) lives in auditable smart
  contracts on Polygon. The database is only a read-optimised cache of onchain events.

**8 games available:**
| Game | Type | Max Payout |
|---|---|---|
| Coin Flip | PvP | 2× |
| Dice | Solo | up to 99× |
| Plinko | Solo | up to 1000× |
| Keno | Solo | up to 10000× |
| Mines | Solo (multi-step) | up to 25× |
| Roulette | Solo | up to 36× |
| Blackjack | Solo (multi-step) | up to 2.5× |
| Hilo | Solo (multi-step) | up to 10000× |
| Wheel | Solo | up to 100× |

**Platform fee:** 10% of profit on winning bets only. No fee on losses.

---

## 2. High-Level Architecture

```
╔══════════════════════════════════════════════════════════════════════════╗
║                         USER'S BROWSER                                   ║
║                                                                          ║
║   ┌─────────────────────────────────────────────────────────────────┐   ║
║   │              Next.js App (React 19, App Router)                 │   ║
║   │                                                                 │   ║
║   │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │   ║
║   │  │  Game Pages  │  │  History /   │  │  Dashboard / Wallet   │ │   ║
║   │  │  (8 games)   │  │  Verify UI   │  │  Balance / Approve    │ │   ║
║   │  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘ │   ║
║   │         │                 │                       │             │   ║
║   │  ┌──────▼─────────────────▼───────────────────────▼───────────┐ │   ║
║   │  │     wagmi + viem + RainbowKit (Web3 client layer)           │ │   ║
║   │  └──────┬──────────────────────────────────────────────────────┘ │   ║
║   └─────────┼───────────────────────────────────────────────────────┘   ║
╚═════════════╪════════════════════════════════════════════════════════════╝
              │  JSON-RPC / contract calls
              ▼
╔══════════════════════════════════════════════════════════════════════════╗
║                    POLYGON AMOY (EVM Blockchain)                         ║
║                                                                          ║
║   GZOToken ◄──► TreasuryVault ◄──► CoinFlipGame                        ║
║                      ▲                  DiceGame                        ║
║                      │              + future games                      ║
║              RandomnessCoordinator                                       ║
║                      ▲                                                   ║
║                Chainlink VRF v2.5                                        ║
║              (verifiable randomness)                                     ║
╚══════════════════════════════════════════════════════════════════════════╝
              │  events emitted on settlement
              ▼
╔══════════════════════════════════════════════════════════════════════════╗
║                    BACKEND (Next.js API Routes)                           ║
║                                                                          ║
║   Auth (SIWE wallet signature) → NextAuth JWT session                   ║
║   Game logic (RNG, settlement math, seed management)                    ║
║   History indexing (reads onchain events, stores in DB)                 ║
╚══════════════════════════════════════════════════════════════════════════╝
              │  read/write
              ▼
╔══════════════════════════════════════════════════════════════════════════╗
║                    POSTGRESQL DATABASE                                    ║
║                                                                          ║
║   Users (keyed by walletAddress)                                        ║
║   GameBet (indexed mirror of onchain events + provably fair seeds)      ║
║   CoinflipMatch, MinesRound, BlackjackRound, HiloRound, etc.           ║
║   LedgerEntry (player balance history)                                  ║
║   HouseTreasury / HouseLedger (offchain accounting)                     ║
╚══════════════════════════════════════════════════════════════════════════╝
```

### Hybrid Architecture Principle

> **Chain = financial source of truth. Database = fast read cache.**

| Concern | Lives On-chain? | Lives In DB? |
|---|---|---|
| GZO token balances | ✅ Yes (ERC-20) | No |
| Bet placement / stake custody | ✅ Yes (TreasuryVault) | Indexed mirror |
| Payout / settlement | ✅ Yes (game contract) | Indexed mirror |
| Randomness (VRF) | ✅ Yes (Chainlink VRF) | Seed stored for verify |
| Game animations & UI | No | No (computed client-side) |
| History search & filter | No | ✅ Yes (indexed) |
| Player profile / display name | No | ✅ Yes |
| Session state (Blackjack, Hilo, Mines mid-game) | Partially | ✅ Primary (with onchain lock) |

---

## 3. Technology Stack

### Frontend
| Package | Version | Purpose |
|---|---|---|
| Next.js | 16.1.6 | App Router, SSR, API routes |
| React | 19.2.3 | UI framework |
| TypeScript | 5 | Type safety |
| wagmi | latest | React hooks for Ethereum |
| viem | latest | Low-level EVM client (replaces ethers) |
| RainbowKit | latest | Wallet connect UI (MetaMask, WalletConnect, etc.) |
| TanStack Query | latest | Data fetching & caching |

### Backend (API Routes inside Next.js)
| Package | Version | Purpose |
|---|---|---|
| Prisma | 7.4.2 | ORM, database access |
| @prisma/adapter-pg | - | PostgreSQL adapter |
| NextAuth v5 | 5.0.0-beta.30 | JWT session management |
| bcryptjs | 3.0.3 | Password hashing (legacy) |
| zod | 4.3.6 | Schema validation |
| node crypto | built-in | HMAC-SHA256 for RNG |

### Smart Contracts
| Package | Purpose |
|---|---|
| Solidity 0.8.24 | Contract language |
| Hardhat 2.22+ | Compile, test, deploy |
| OpenZeppelin Contracts v5 | ERC-20, AccessControl, UUPS, Pausable, SafeERC20 |
| @openzeppelin/hardhat-upgrades | Deploy and upgrade UUPS proxies |
| @chainlink/contracts | VRF v2.5 consumer interface |
| hardhat-contract-sizer | Contract size validation |

### Infrastructure
| | |
|---|---|
| Database | PostgreSQL |
| Testnet | Polygon Amoy (chainId 80002) |
| Local blockchain | Hardhat (chainId 31337) |
| Randomness oracle | Chainlink VRF v2.5 |

---

## 4. Repository Structure

```
Casino/
│
├── src/                          ← Next.js application
│   ├── app/
│   │   ├── page.tsx              ← Homepage (marketing, unauthenticated)
│   │   ├── layout.tsx            ← Root layout: fonts, NavBar, Web3Providers
│   │   ├── providers.tsx         ← wagmi + RainbowKit + TanStack Query setup
│   │   ├── dashboard/page.tsx    ← User dashboard (balance, games grid)
│   │   ├── coinflip/             ← CoinFlip game (web3-enabled)
│   │   ├── dice/                 ← Dice game
│   │   ├── plinko/               ← Plinko game
│   │   ├── keno/                 ← Keno game
│   │   ├── mines/                ← Mines game
│   │   ├── roulette/             ← Roulette game
│   │   ├── blackjack/            ← Blackjack game
│   │   ├── hilo/                 ← Hilo game
│   │   ├── wheel/                ← Wheel game
│   │   ├── history/page.tsx      ← Full bet history with pagination
│   │   ├── verify/               ← Provably fair verification tool
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── [...nextauth]/  ← NextAuth handler
│   │       │   ├── signup/         ← User registration
│   │       │   └── wallet/
│   │       │       ├── nonce/      ← SIWE nonce generation (Web3 auth)
│   │       │       └── verify/     ← SIWE signature verification (Web3 auth)
│   │       ├── coinflip/           ← CoinFlip API (create, join, verify, etc.)
│   │       ├── games/              ← Solo game APIs (dice, plinko, keno, etc.)
│   │       ├── history/            ← Full history API with pagination
│   │       ├── fairness/seeds/     ← Seed management API
│   │       └── admin/treasury/     ← Admin treasury API
│   │
│   ├── components/
│   │   ├── NavBar.tsx            ← Top navigation with WalletButton
│   │   ├── WalletButton.tsx      ← RainbowKit connect + GZO balance pill
│   │   ├── NetworkGuard.tsx      ← Requires wallet + correct chain
│   │   ├── ApproveGZO.tsx        ← Approve-then-act wrapper component
│   │   ├── TxStatus.tsx          ← Transaction pending/success/error UI
│   │   ├── GamesGrid.tsx         ← All 8 games grid (dashboard)
│   │   ├── HomeGamesGrid.tsx     ← Games grid (homepage, client component)
│   │   ├── OtherGames.tsx        ← "Play another game" carousel
│   │   ├── TransactionHistory.tsx← Recent bets widget (per-game pages)
│   │   ├── FairnessWidget.tsx    ← Shows server seed hash / client seed / nonce
│   │   ├── GameIcons.tsx         ← 8 custom SVG game icons
│   │   └── SessionProvider.tsx   ← NextAuth SessionProvider wrapper
│   │
│   └── lib/
│       ├── auth.ts               ← NextAuth config (SIWE + legacy credentials)
│       ├── prisma.ts             ← Prisma singleton (adapter-pg pattern)
│       ├── rng.ts                ← HMAC-SHA256 RNG primitives (ALL games share this)
│       ├── seedManager.ts        ← Per-user seed state CRUD (commit/reveal)
│       ├── settlement.ts         ← Fee calculation (10% on profit only)
│       ├── house.ts              ← House treasury DB accounting
│       ├── ledger.ts             ← LedgerEntryType enum
│       ├── coinflip.ts           ← CoinFlip-specific logic
│       ├── dice.ts               ← Dice-specific logic
│       ├── plinko.ts             ← Plinko multiplier tables + path logic
│       ├── keno.ts               ← Keno draw + paytable
│       ├── mines.ts              ← Mines position generation + multiplier
│       ├── roulette.ts           ← Roulette spin + payout breakdown
│       ├── blackjack.ts          ← Full card game engine (293 lines)
│       ├── hilo.ts               ← Hilo deck + guess logic
│       ├── wheel.ts              ← Wheel segment + multiplier
│       └── web3/
│           ├── config.ts         ← wagmi chains + transport config
│           ├── contracts.ts      ← ABIs + deployed addresses
│           ├── deployed-addresses.json ← Auto-written by deploy script
│           └── hooks/
│               ├── useGZOBalance.ts   ← Read GZO balance + allowance
│               ├── useApproval.ts     ← Write: approve GZO, use faucet
│               └── useCoinFlip.ts     ← Write: createMatch, joinMatch, cancel
│
├── contracts/                    ← Hardhat smart contract project
│   ├── hardhat.config.ts
│   ├── package.json
│   ├── deployed-addresses.json   ← Auto-written after deploy
│   ├── contracts/
│   │   ├── token/GZOToken.sol
│   │   ├── core/
│   │   │   ├── TreasuryVault.sol
│   │   │   ├── GameRegistry.sol
│   │   │   └── RandomnessCoordinator.sol
│   │   ├── games/
│   │   │   ├── interfaces/IGame.sol
│   │   │   ├── CoinFlipGame.sol
│   │   │   └── DiceGame.sol
│   │   ├── libraries/GameMath.sol
│   │   └── mocks/MockVRFCoordinator.sol
│   ├── scripts/deploy.ts
│   └── test/
│       ├── GZOToken.test.ts
│       ├── TreasuryVault.test.ts
│       └── CoinFlipGame.test.ts
│
├── prisma/
│   └── schema.prisma             ← Database schema (all models)
│
├── DEPLOYMENT.md                 ← Deployment instructions
├── KNOWLEDGE_TRANSFER.md         ← This document
└── .env.example                  ← All environment variables
```

---

## 5. GZO Token

**GZO (Gamezo)** is the single in-game currency used for all bets and payouts.

### On-chain (web3 layer)
- Standard ERC-20, 18 decimal places
- Contract: `GZOToken.sol` — UUPS upgradeable
- **Faucet function:** `faucet()` mints 10,000 GZO to the caller (testnet only, no access control — for player onboarding)
- **Mint function:** `mint(address, amount)` — requires `MINTER_ROLE` (admin/treasury only)
- Roles: `MINTER_ROLE`, `PAUSER_ROLE`, `UPGRADER_ROLE`, `DEFAULT_ADMIN_ROLE`

### Off-chain (legacy DB layer)
- Stored as `Decimal(18,8)` strings in PostgreSQL (`WalletBalance.balance`)
- Tracked via `LedgerEntry` rows (DEPOSIT, WITHDRAWAL, BET_PLACED, BET_WON, BET_REFUND)
- Integer operations everywhere: `Math.floor()` applied before DB writes to prevent floating-point drift

### Unit convention
- **Display:** `1 GZO` = 1 token
- **On-chain:** `1 GZO` = `1e18` wei (standard ERC-20)
- **Off-chain:** raw integer credits stored as Decimal strings

---

## 6. Token Flow — How GZO Moves

### 6.1 Single-Player Game (e.g. Dice, Plinko, Keno)

```
PLAYER WALLET
     │
     │  1. player calls approve(treasuryVault, stakeAmount)
     │
     ▼
GZO TOKEN CONTRACT
     │
     │  2. game contract calls treasury.lockStake(gameId, roundId, player, stake)
     │     └─ safeTransferFrom(player → treasuryVault)
     ▼
TREASURY VAULT  ◄──────────────────────────────────────────────────────┐
     │                                                                  │
     │  3. game contract calls coordinator.requestRandomness(...)      │
     ▼                                                                  │
RANDOMNESS COORDINATOR                                                  │
     │                                                                  │
     │  4. Chainlink VRF fulfills → rawFulfillRandomWords(...)         │
     ▼                                                                  │
GAME CONTRACT (e.g. DiceGame)                                          │
     │                                                                  │
     │  5a. If PLAYER WINS:                                            │
     │      treasury.payout(gameId, roundId, player, netPayout, fee)  │
     │      └─ safeTransfer(treasuryVault → player, netPayout)        │
     │      └─ fee stays in vault as house profit                      │
     │      treasury.refundLoss(gameId, roundId, player, stake)        │
     │      └─ stake stays in vault (consumed by loss accounting)      │
     │                                                                  │
     │  5b. If PLAYER LOSES:                                            │
     │      treasury.refundLoss(gameId, roundId, player, stake)        │
     │      └─ stake stays in vault (house keeps it all)               │
     │                                                                  │
     └──────────────────────────────────────────────────────────────────┘

                           TREASURY VAULT BALANCE SHEET
                           ┌────────────────────────────────────┐
                           │ Initial Bankroll: 1,000,000 GZO    │
                           │ + Losing stakes received           │
                           │ + Fees from winning bets           │
                           │ - Net payouts to winners           │
                           │ = Current Vault Balance            │
                           └────────────────────────────────────┘
```

### 6.2 CoinFlip (PvP)

```
PLAYER A WALLET          PLAYER B WALLET
     │                        │
     │ approve(treasury, S)   │ approve(treasury, S)
     │                        │
     ▼                        ▼
COINFLIP GAME CONTRACT
     │
     │  createMatch(stake S, side HEADS)
     │  └─ treasury.lockStake(COINFLIP, roundId, playerA, S)
     │     └─ transferFrom(playerA → vault, S)
     │
     │  joinMatch(roundId)
     │  └─ treasury.lockStake(COINFLIP, roundId, playerB, S)
     │     └─ transferFrom(playerB → vault, S)
     │  └─ coordinator.requestRandomness(...)
     │
     │  [VRF fulfills → fulfillRandomness()]
     │  └─ outcome = randomWord % 2 == 0 ? HEADS : TAILS
     │  └─ winner determined
     │
     │  If PLAYER A wins (pot = 2S, fee = 10% of S profit):
     │  └─ treasury.payout(COINFLIP, roundId, playerA, 1.9×S, 0.1×S)
     │     └─ safeTransfer(vault → playerA, 1.9×S)
     │  └─ treasury.refundLoss(COINFLIP, roundId, playerB, S)
     │     └─ B's stake absorbed into vault
     │
     ▼
EVENTS EMITTED:
  MatchCreated(roundId, playerA, stake, side)
  MatchJoined(roundId, playerB, vrfRequestId)
  MatchSettled(roundId, outcome, winner, netPayout, fee)
  StakeLocked × 2, PayoutSent × 1, FeeCollected × 1
```

### 6.3 Multi-Step Session Game (e.g. Mines, Blackjack, Hilo)

```
SESSION START:
  player → approve(treasury, stake)
  player → game.startRound(stake, config)
               └─ treasury.lockStake(gameId, roundId, player, stake)
               └─ seed committed (serverSeedHash stored on round)
               └─ game state = ACTIVE in DB

EACH MOVE (reveal tile / hit / guess higher):
  player → game.makeMove(roundId, moveData)      ← offchain API call
               └─ validates move is legal
               └─ updates session state in DB
               └─ NO on-chain tx per move (gas efficient)

SESSION END — CASHOUT:
  player → game.cashout(roundId)
               └─ final multiplier computed
               └─ settlement = settle(stake, gross)
               └─ treasury.payout(gameId, roundId, player, net, fee)
               └─ server seed REVEALED (stored in round, shown in UI)
               └─ GameBet record created (status = SETTLED)

SESSION END — LOSS (hit mine / bust / wrong guess):
  automatic on the losing move API call
               └─ treasury.refundLoss(gameId, roundId, player, stake)
               └─ server seed REVEALED
               └─ GameBet record created (status = SETTLED, profit < 0)
```

---

## 7. Smart Contract Architecture

### 7.1 Contract Dependency Graph

```
                    ┌─────────────────┐
                    │   GZOToken.sol   │
                    │  (ERC-20, UUPS) │
                    └────────┬────────┘
                             │ IERC20 reference
                    ┌────────▼────────┐
                    │ TreasuryVault   │◄─────────────────────────────┐
                    │   (UUPS)        │                              │
                    └────────┬────────┘                              │
                             │ lockStake / payout / refund           │
              ┌──────────────┼──────────────────┐                   │
              │              │                  │                   │
     ┌────────▼───────┐ ┌────▼──────────┐       │   grants GAME_ROLE│
     │  CoinFlipGame  │ │   DiceGame    │       │                   │
     │    (UUPS)      │ │   (UUPS)      │  + future games           │
     └────────┬───────┘ └────┬──────────┘       │                   │
              │              │                  │                   │
              └──────┬───────┘                  │                   │
                     │ requestRandomness()       │                   │
            ┌────────▼────────────┐             │                   │
            │ RandomnessCoordinator│◄────────────┘                   │
            │       (UUPS)        │                                  │
            └────────┬────────────┘                                  │
                     │ rawFulfillRandomWords()                        │
            ┌────────▼────────┐                                      │
            │ Chainlink VRF   │                                      │
            │  Coordinator    │                                      │
            └─────────────────┘                                      │
                                                                     │
            ┌─────────────────┐                                      │
            │  GameRegistry   │──── tracks all deployed games        │
            │    (UUPS)       │──── enable / disable games ──────────┘
            └─────────────────┘
```

### 7.2 Contract Details

---

#### `GZOToken.sol`
**Location:** `contracts/contracts/token/GZOToken.sol`
**Pattern:** ERC-20, UUPS upgradeable, AccessControl

```
Storage:
  (inherited from ERC-20Upgradeable)
  _balances: mapping(address → uint256)
  _allowances: mapping(address → mapping(address → uint256))
  _totalSupply: uint256
  _name: string = "Gamezo"
  _symbol: string = "GZO"

Roles:
  DEFAULT_ADMIN_ROLE  → can grant/revoke other roles
  MINTER_ROLE         → can call mint()
  PAUSER_ROLE         → can call pause() / unpause()
  UPGRADER_ROLE       → can upgrade the proxy implementation

Key functions:
  initialize(admin)          → sets up roles, called once on proxy deploy
  mint(to, amount)           → MINTER_ROLE only
  faucet()                   → permissionless, mints 10,000 GZO to caller (testnet)
  pause() / unpause()        → PAUSER_ROLE
  _authorizeUpgrade(newImpl) → UPGRADER_ROLE
```

---

#### `TreasuryVault.sol`
**Location:** `contracts/contracts/core/TreasuryVault.sol`
**Pattern:** UUPS upgradeable, AccessControl, Pausable, ReentrancyGuard

```
Storage:
  gzoToken: IERC20                       → the GZO token contract
  totalFeesAccrued: uint256              → lifetime fee counter
  totalBankroll: uint256                 → current free balance
  lockedByGame: mapping(bytes32 → uint256) → per-game locked amount

Roles:
  DEFAULT_ADMIN_ROLE  → depositBankroll
  GAME_ROLE           → lockStake, payout, refundLoss, cancelRefund
  FEE_ROLE            → withdrawBankroll
  PAUSER_ROLE         → pause / unpause
  UPGRADER_ROLE       → upgrade

Key functions:
  lockStake(gameId, roundId, player, amount)
    → safeTransferFrom(player → this)
    → lockedByGame[gameId] += amount
    → emits StakeLocked

  payout(gameId, roundId, winner, netAmount, feeAmount)
    → verifies lockedByGame[gameId] >= gross
    → lockedByGame[gameId] -= gross
    → safeTransfer(this → winner, netAmount)
    → fee stays in vault
    → emits PayoutSent, FeeCollected

  refundLoss(gameId, roundId, player, amount)
    → lockedByGame[gameId] -= amount
    → stake stays in vault (house profit)
    → emits StakeRefunded

  cancelRefund(gameId, roundId, player, amount)
    → lockedByGame[gameId] -= amount
    → safeTransfer(this → player, amount)
    → full refund on error/cancel

  canPay(amount) → bool
    → checks vault has enough free balance (not locked) to cover payout

Events:
  StakeLocked(gameId, player, amount, roundId)
  PayoutSent(gameId, winner, netAmount, roundId)
  FeeCollected(gameId, feeAmount, roundId)
  StakeRefunded(gameId, player, amount, roundId)
  BankrollDeposited(depositor, amount)
  BankrollWithdrawn(to, amount)
```

---

#### `GameRegistry.sol`
**Location:** `contracts/contracts/core/GameRegistry.sol`
**Pattern:** UUPS upgradeable, AccessControl

```
Storage:
  games: mapping(bytes32 gameId → GameInfo)
  gameIds: bytes32[]

  struct GameInfo {
    address contractAddr
    bool    enabled
    string  name
    uint256 registeredAt
  }

Key functions:
  registerGame(gameId, contractAddr) → OPERATOR_ROLE
  enableGame(gameId)                 → OPERATOR_ROLE
  disableGame(gameId)                → OPERATOR_ROLE
  upgradeGame(gameId, newAddr)       → DEFAULT_ADMIN_ROLE
  getGame(gameId)                    → returns GameInfo
  isEnabled(gameId)                  → bool
  allGameIds()                       → bytes32[]

Game IDs (keccak256 of name string):
  keccak256("COINFLIP") → CoinFlipGame.sol
  keccak256("DICE")     → DiceGame.sol
  (more to be registered as games are deployed)
```

---

#### `RandomnessCoordinator.sol`
**Location:** `contracts/contracts/core/RandomnessCoordinator.sol`
**Pattern:** UUPS upgradeable, AccessControl, Chainlink VRF v2.5 consumer

```
Storage:
  vrfCoordinator: address       → Chainlink VRF coordinator address
  keyHash: bytes32              → VRF key hash (gas lane)
  subscriptionId: uint256       → Chainlink subscription ID
  requests: mapping(uint256 → Request)

  struct Request {
    bytes32 gameId
    address gameContract
    bytes32 roundId
    bool    fulfilled
  }

Constants:
  MIN_CONFIRMATIONS = 3
  CALLBACK_GAS      = 500,000
  NUM_WORDS         = 1

Flow:
  1. Game contract calls requestRandomness(gameId, roundId, gameContract)
  2. Coordinator calls Chainlink VRF → returns vrfRequestId
  3. Stores request mapping: vrfRequestId → Request
  4. Chainlink calls rawFulfillRandomWords(vrfRequestId, randomWords[])
  5. Coordinator verifies msg.sender == vrfCoordinator
  6. Marks request fulfilled
  7. Calls IGame(request.gameContract).fulfillRandomness(vrfRequestId, randomWords)

Key functions:
  requestRandomness(gameId, roundId, gameContract) → GAME_ROLE only → vrfRequestId
  rawFulfillRandomWords(vrfRequestId, randomWords[]) → only Chainlink coordinator
  setVRFConfig(coord, keyHash, subId) → DEFAULT_ADMIN_ROLE

Events:
  RandomnessRequested(vrfRequestId, gameId, roundId)
  RandomnessFulfilled(vrfRequestId, gameId, roundId, randomWord)
```

---

#### `CoinFlipGame.sol`
**Location:** `contracts/contracts/games/CoinFlipGame.sol`
**Pattern:** UUPS upgradeable, AccessControl, Pausable, ReentrancyGuard, IGame

```
Storage:
  treasury: TreasuryVault
  randomness: RandomnessCoordinator
  minStake: uint256
  maxStake: uint256
  matches: mapping(bytes32 roundId → Match)
  vrfToRound: mapping(uint256 vrfRequestId → bytes32 roundId)
  matchNonce: uint256   → increments per match for unique roundIds

  struct Match {
    address  playerA
    address  playerB
    uint256  stake
    Side     playerAChoice   (0=HEADS, 1=TAILS)
    Side     outcome
    address  winner
    MatchStatus status       (0=PENDING, 1=ACTIVE, 2=SETTLED, 3=CANCELLED)
    uint256  vrfRequestId
    uint64   createdAt
    uint64   settledAt
  }

Round ID generation:
  roundId = keccak256(abi.encodePacked("coinflip", playerA, matchNonce++, block.timestamp))

Key functions:
  createMatch(stake, side)
    1. Validates stake in [minStake, maxStake]
    2. Calls treasury.canPay(stake) — solvency check
    3. Generates roundId
    4. Creates Match (status=PENDING)
    5. Calls treasury.lockStake(GAME_ID, roundId, msg.sender, stake)
    6. Emits MatchCreated

  joinMatch(roundId)
    1. Validates match is PENDING and msg.sender != playerA
    2. Sets playerB, status=ACTIVE
    3. Calls treasury.lockStake(GAME_ID, roundId, msg.sender, stake)
    4. Calls coordinator.requestRandomness(GAME_ID, roundId, address(this))
    5. Stores vrfToRound mapping
    6. Emits MatchJoined

  cancelMatch(roundId)
    1. Validates status=PENDING, msg.sender=playerA
    2. Sets status=CANCELLED
    3. Calls treasury.cancelRefund(GAME_ID, roundId, playerA, stake)
    4. Emits MatchCancelled

  fulfillRandomness(vrfRequestId, randomWords[])  ← called by RandomnessCoordinator
    1. msg.sender must be address(randomness)
    2. Looks up roundId from vrfToRound
    3. outcome = randomWords[0] % 2 == 0 ? HEADS : TAILS
    4. winner determined by comparing outcome to playerAChoice
    5. pot = 2 × stake; fee = 10% of stake (profit per player)
    6. treasury.payout(GAME_ID, roundId, winner, 1.9×stake, 0.1×stake)
    7. treasury.refundLoss(GAME_ID, roundId, loser, stake)
    8. Emits MatchSettled

Events:
  MatchCreated(roundId, playerA, stake, side)
  MatchJoined(roundId, playerB, vrfRequestId)
  MatchSettled(roundId, outcome, winner, netPayout, fee)
  MatchCancelled(roundId, playerA)
```

---

#### `DiceGame.sol`
**Location:** `contracts/contracts/games/DiceGame.sol`
**Pattern:** Same as CoinFlipGame (UUPS, AccessControl, Pausable, ReentrancyGuard, IGame)

```
Key difference from CoinFlip:
  - Single player (no opponent)
  - targetScaled = target × 100 (e.g. 5050 = 50.50 target)
  - Roll derived: randomWord % 10_000 → [0, 9999]
  - Win: roll < targetScaled
  - Gross: floor(stake × 9900 / targetScaled)

Round struct:
  player, stake, targetScaled, roll, netPayout, won, settled, createdAt

Flow:
  1. placeBet(stake, targetScaled)
     → solvency check: canPay(gross)
     → lockStake(DICE, roundId, player, stake)
     → requestRandomness(DICE, roundId, address(this))

  2. fulfillRandomness(vrfRequestId, randomWords)
     → roll = randomWords[0] % 10_000
     → won = roll < targetScaled
     → if won: payout(DICE, roundId, player, net, fee)
     → refundLoss(DICE, roundId, player, stake)  [always — accounting]
     → emits RoundSettled
```

---

#### `GameMath.sol` (Library)
**Location:** `contracts/contracts/libraries/GameMath.sol`

```solidity
Constants:
  FEE_BPS = 1000  (10% = 1000 basis points)
  BPS_DENOM = 10_000

Functions:
  settle(stake, gross) → Settlement { grossPayout, profitAmount, feeAmount, netPayout }
    fee = profitAmount > 0 ? profitAmount × 1000 / 10000 : 0
    net = gross - fee

  diceGross(stake, targetScaled) → uint256
    = (stake × 9900) / targetScaled

  vrfToDiceRoll(randomWord) → uint256 [0, 9999]
    = randomWord % 10_000

  vrfToCoinFlip(randomWord) → bool isHeads
    = (randomWord % 2) == 0

  vrfToWheelSegment(randomWord, count) → uint256
    = randomWord % count

  vrfToRouletteNumber(randomWord) → uint256 [0, 36]
    = randomWord % 37
```

### 7.3 Role Matrix

```
Role                  │ GZOToken │ TreasuryVault │ GameRegistry │ Coordinator │ Games
──────────────────────┼──────────┼───────────────┼──────────────┼─────────────┼──────
DEFAULT_ADMIN_ROLE    │    ✓     │       ✓       │      ✓       │      ✓      │   ✓
MINTER_ROLE           │    ✓     │               │              │             │
PAUSER_ROLE           │    ✓     │       ✓       │              │             │   ✓
UPGRADER_ROLE         │    ✓     │       ✓       │      ✓       │      ✓      │   ✓
GAME_ROLE             │          │       ✓       │              │      ✓      │
OPERATOR_ROLE         │          │               │      ✓       │             │   ✓
FEE_ROLE              │          │       ✓       │              │             │
```

**On deploy, the deployer address gets all roles.**
In production, split into multisig admin, separate pauser (ops), separate upgrader (timelock).

---

## 8. Provably Fair RNG System

### Core Formula

```
randomBytes = HMAC-SHA256(key = serverSeed, data = "clientSeed:publicSeed:nonce")
```

All 8 games share this single formula. The 32-byte output is then decoded into a
game-specific result (float, integer, path, etc.) using deterministic functions.

### Seed Components

```
┌─────────────────────────────────────────────────────────────────────┐
│  serverSeed  (32 random bytes, hex string)                          │
│  └─ Chosen by the server BEFORE the bet                             │
│  └─ Never revealed during an active round                           │
│  └─ SHA-256(serverSeed) = serverSeedHash (shown to player pre-bet) │
│  └─ Revealed AFTER round settles (auditable)                        │
│  └─ Rotated to a fresh seed after each settled round                │
│                                                                     │
│  clientSeed  (arbitrary string, default: random hex)               │
│  └─ Player can change this any time before betting                  │
│  └─ Contributes entropy the server cannot predict                   │
│                                                                     │
│  publicSeed  (deterministic, game-specific)                         │
│  └─ e.g. "dice:userId", "coinflip:matchId:playerBId"               │
│  └─ Publicly derivable — no secrets needed to verify                │
│                                                                     │
│  nonce       (integer, starts at 0, increments each settled round) │
│  └─ Ensures each bet produces a unique output even with same seeds  │
└─────────────────────────────────────────────────────────────────────┘
```

### Commit-Reveal Guarantee

```
BEFORE BET:            server commits SHA-256(serverSeed) → shown to player
AFTER BET SETTLES:     server reveals serverSeed → player can verify SHA-256 matches
NEXT ROUND:            server rotates to a fresh serverSeed → new commitment published

This makes it mathematically impossible for the server to choose the outcome
after seeing the player's bet, because the serverSeed was committed before the bet.
```

### Byte Conversion Functions (`src/lib/rng.ts`)

```typescript
hmacSha256Bytes(serverSeed, clientSeed, publicSeed, nonce) → Buffer (32 bytes)

bytesToFloat(bytes)          → float [0, 1)       using 52-bit IEEE 754 mantissa
bytesToInt(bytes, min, max)  → int [min, max]      delegates to bytesToFloat
bytesToDiceRoll(bytes)       → float [0.00, 99.99] floor(float × 10000) / 100
bytesToPlinkoPath(bytes, rows) → bool[]            LSB of byte[i] = direction at row i
bytesToCoinFlip(bytes)       → "HEADS"|"TAILS"     high nibble of byte[0]: even=HEADS
bytesToKenoDraw(bytes)       → number[10]          Fisher-Yates shuffle of [1..40]
```

### Seed Rotation (`src/lib/seedManager.ts`)

```
PlayerSeedState (one row per user in DB):
  serverSeed         → secret HMAC key, never exposed via API
  serverSeedHash     → SHA-256(serverSeed), shown pre-bet
  clientSeed         → player-settable
  nonce              → increments on each settled bet
  prevServerSeedHash → audit trail of last revealed seed

Key invariant: seed rotates ONLY AFTER settlement, never before.
This preserves the commit-reveal property — the server cannot change the seed mid-round.
```

### Player Verification Flow

```
Player wants to verify a past bet:

1. Player goes to /verify page
2. Enters bet ID (or uses the "Verify" link in History)
3. App shows:
   - serverSeed (revealed post-settlement)
   - clientSeed (player chose this)
   - publicSeed (deterministic, shown)
   - nonce (shown)
4. Player independently computes:
   HMAC-SHA256(serverSeed, "clientSeed:publicSeed:nonce")
5. Applies the same byte conversion as the game used
6. Confirms the outcome matches what was reported
7. Confirms SHA-256(serverSeed) matches the serverSeedHash committed pre-bet
```

---

## 9. Settlement & Fee Model

### Formula

```
profitGzo = grossPayoutGzo - stakeGzo

feeGzo    = profitGzo > 0
              ? floor(profitGzo × 0.10)
              : 0

netPayoutGzo = grossPayoutGzo - feeGzo
```

**Key point: fee is 10% of profit, not 10% of the gross payout or stake.**

### Examples

| Scenario | Stake | Gross Payout | Profit | Fee (10%) | Net to Player |
|---|---|---|---|---|---|
| CoinFlip win | 100 | 200 | 100 | 10 | 190 |
| Dice win (target 50, mult 1.98×) | 100 | 198 | 98 | 9 | 189 |
| Dice loss | 100 | 0 | -100 | 0 | 0 |
| Keno win (target 5×) | 100 | 500 | 400 | 40 | 460 |
| Plinko hit 1000× | 10 | 10000 | 9990 | 999 | 9001 |

### Solidity Implementation (GameMath.sol)

```solidity
struct Settlement {
  uint256 grossPayout;
  uint256 profitAmount;
  uint256 feeAmount;
  uint256 netPayout;
}

function settle(uint256 stake, uint256 gross) pure returns (Settlement) {
  s.grossPayout = gross;
  if (gross > stake) {
    s.profitAmount = gross - stake;
    s.feeAmount = (s.profitAmount * 1000) / 10_000;  // 10%
  }
  s.netPayout = gross - s.feeAmount;
}
```

---

## 10. Game-by-Game Reference

---

### CoinFlip — PvP

**Type:** Player vs Player
**Max payout:** 2× (winner takes opponent's stake)
**Fee:** 10% of profit (10% of the stake won)

```
PARAMETERS:
  stake    → GZO amount per player (both must stake the same)
  side     → "HEADS" or "TAILS" (Player A's choice; Player B automatically takes the other)

RNG:
  bytes    = HMAC-SHA256(serverSeed_A, clientSeed_B : matchId:playerBId : nonce)
  outcome  = high nibble of bytes[0]: even = HEADS, odd = TAILS
  On-chain: randomWord % 2 == 0 → HEADS

EXAMPLE:
  PlayerA stakes 100 GZO, picks HEADS
  PlayerB stakes 100 GZO (auto-takes TAILS)
  Pot = 200 GZO
  VRF → randomWord = 7 → odd → TAILS → PlayerB WINS
  Gross = 200, Profit = 100, Fee = 10, Net = 190
  PlayerB receives 190 GZO, PlayerA receives 0

STATE MACHINE:
  PENDING → (PlayerB joins) → ACTIVE → (VRF fulfills) → SETTLED
  PENDING → (PlayerA cancels) → CANCELLED

API ROUTES:
  POST /api/coinflip/create      { stake, side }      → { matchId, commitHash, nonce }
  POST /api/coinflip/join        { matchId }           → { outcome, winner, payouts }
  GET  /api/coinflip/matches                           → list of PENDING matches
  GET  /api/coinflip/match/:id                         → match details
  GET  /api/coinflip/history                           → user's coinflip history
  POST /api/coinflip/verify      { matchId }           → HMAC verification data

SMART CONTRACT: CoinFlipGame.sol (fully migrated)
  createMatch(stake, side) → bytes32 roundId
  joinMatch(roundId)
  cancelMatch(roundId)
  getMatch(roundId) → Match struct
```

---

### Dice

**Type:** Solo (player vs house)
**Max payout:** up to 99× (target = 1.01)
**Fee:** 10% of profit

```
PARAMETERS:
  stakeGzo → GZO amount
  target   → float [1.01, 98.00] — player wins if roll < target
  mode     → "ROLL_UNDER" (only mode currently)

RNG:
  publicSeed = "dice:{userId}"
  bytes  = HMAC-SHA256(serverSeed, clientSeed : dice:{userId} : nonce)
  roll   = floor(bytesToFloat(bytes) × 10000) / 100   → [0.00, 99.99]

WIN CONDITION: roll < target
MULTIPLIER: 99 / target
GROSS:      floor(stake × multiplier)

EXAMPLES:
  target=50.00 → mult=1.98× → win ~50% of rolls
  target=10.00 → mult=9.90× → win ~10% of rolls
  target=1.01  → mult=98.02×→ win ~1% of rolls

API ROUTE: POST /api/games/dice/bet
  Body: { stakeGzo: number, target: number, mode: "ROLL_UNDER" }
  Response: { betId, roll, target, won, payouts, seeds, rngVersion }

SMART CONTRACT: DiceGame.sol (fully deployed)
  placeBet(stake, targetScaled) where targetScaled = target × 100
  getRound(roundId) → Round struct
```

---

### Plinko

**Type:** Solo
**Max payout:** up to 1000× (high risk, 16 rows, far edge bin)
**Fee:** 10% of profit

```
PARAMETERS:
  stakeGzo → GZO amount
  rows     → 8 | 12 | 16  (ball drop height)
  risk     → "low" | "med" | "high" (multiplier spread)

RNG:
  publicSeed = "plinko:{userId}"
  bytes   = HMAC-SHA256(serverSeed, clientSeed : plinko:{userId} : nonce)
  path    = bytesToPlinkoPath(bytes, rows)
    → bool array: path[i] = LSB of bytes[i] → false=left, true=right
  binIndex = count of true values in path  → [0, rows]
  multiplier = PLINKO_MULTIPLIERS[rows][risk][binIndex]
  gross = floor(stake × multiplier)

MULTIPLIER TABLES (examples):
  8 rows  low  → [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6]
  8 rows  high → [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29]
  16 rows high → very wide spread, 1000× at extreme bins

API ROUTE: POST /api/games/plinko/bet
  Body: { stakeGzo, rows: 8|12|16, risk: "low"|"med"|"high" }
  Response: { betId, path, binIndex, multiplier, won, payouts, seeds }
```

---

### Keno

**Type:** Solo
**Max payout:** up to 10000× (pick 10, match all 10)
**Fee:** 10% of profit

```
PARAMETERS:
  stakeGzo    → GZO amount
  picks       → number[] of 1–10 values from the range [1, 40]

RNG:
  publicSeed = "keno:{userId}"
  draw = bytesToKenoDraw(HMAC bytes)
    Fisher-Yates shuffle of [1..40] → first 10 = drawn numbers (sorted ascending)

PAYTABLE: KENO_PAYTABLE[pickCount][matchCount] = gross multiplier
  Example (5 picks): [0, 0, 0.5, 2.5, 9, 75]
  Pick 5, match 5 → 75× gross

API ROUTE: POST /api/games/keno/bet
  Body: { stakeGzo, picks: number[] }
  Response: { betId, drawnNumbers, matches, multiplier, won, payouts, seeds }
```

---

### Mines

**Type:** Solo, multi-step
**Max payout:** up to 25× (1 mine, 24 safe reveals)
**Fee:** 10% of profit
**Session:** Round lasts multiple API calls (reveal → reveal → cashout)

```
PARAMETERS (at start):
  stakeGzo  → GZO amount, locked at session start
  mineCount → 1–24 (number of mines on the 5×5 board)

MINE GENERATION:
  Dual HMAC stream (two SHA256 blocks = 64 bytes for sufficient entropy)
  Fisher-Yates shuffle of tiles [0..24] using uint16BE reads from bytes
  minePositions = first mineCount tiles after shuffle (sorted)

MULTIPLIER:
  After K safe reveals with M mines on N=25 tiles:
  mult = C(N, K) / C(N - M, K)
  This is the mathematically fair odds ratio; house edge comes only from the 10% fee.

EXAMPLE (3 mines):
  After 5 safe reveals: mult ≈ 1.74×
  After 10 safe reveals: mult ≈ 5.08×
  After 20 safe reveals: mult ≈ 79.8×

STATE MACHINE:
  ACTIVE → (reveal safe tile) → ACTIVE (multiplier grows)
  ACTIVE → (reveal mine)      → LOST   (stake lost, server seed revealed)
  ACTIVE → (cashout)          → CASHED_OUT (paid out, server seed revealed)

DB MODEL: MinesRound
  id, userId, stakeGzo, mineCount, boardSize=25,
  minePositions (JSON, hidden during ACTIVE),
  revealedTiles (JSON, grows each reveal),
  status (ACTIVE|CASHED_OUT|LOST),
  multiplierPath (JSON, recorded each reveal),
  currentMultiplier, grossPayoutGzo, profitGzo, feeGzo, netPayoutGzo,
  serverSeed (revealed on end), serverSeedHash, clientSeed, nonce, publicSeed

API ROUTES:
  POST /api/games/mines/start    { stakeGzo, mineCount }
  POST /api/games/mines/reveal   { tileIndex }           → reveals tile
  POST /api/games/mines/cashout                          → settles and pays
  POST /api/games/mines/forfeit                          → abandons, partial refund
  GET  /api/games/mines/current                          → current active round
  GET  /api/games/mines/history                          → past rounds
```

---

### Roulette

**Type:** Solo
**Max payout:** 36× (single number)
**Fee:** 10% of profit

```
PARAMETERS:
  bets → array of { area: string, stake: number }
  Areas: number 0-36, "red", "black", "green", "even", "odd",
         "1-18", "19-36", "1st12", "2nd12", "3rd12",
         "col1", "col2", "col3"

RNG:
  publicSeed = "roulette:{userId}"
  winningNumber = bytesToInt(HMAC bytes, 0, 36)  → European wheel [0, 36]
  winningColor: 0=green, red numbers, black numbers (standard European layout)

PAYOUTS:
  Single number: 36× gross (35:1 odds)
  Color/even-odd: 2× gross (1:1 odds)
  Dozen/column: 3× gross (2:1 odds)
  Half: 2× gross (1:1 odds)

Multiple bets in one spin — each bet evaluated independently.

API ROUTE: POST /api/games/roulette/spin
  Body: { bets: [{area, stake}] }
  Response: { betId, winningNumber, winningColor, breakdown, totalNet, seeds }
```

---

### Blackjack

**Type:** Solo, multi-step
**Max payout:** 2.5× (blackjack pays 3:2)
**Fee:** 10% of profit
**Session:** Full hand with hit/stand/double/split

```
DECK:
  Standard 52-card deck, shuffled via HMAC-seeded Fisher-Yates at round start.
  All cards derived deterministically from the server seed.
  Deck shuffled once per round (not per deal).

ACTIONS:
  deal     → receive 2 cards, dealer receives 2 (1 face-down hole card)
  hit      → receive next card from deck
  stand    → end turn
  double   → double stake, receive exactly 1 more card
  split    → split pairs into two hands (requires equal new stake)

OUTCOMES:
  BLACKJACK  → 2.5× gross (only on initial 2-card natural 21)
  WIN        → 2× gross
  PUSH       → 1× gross (stake returned, no fee)
  LOSS       → 0× gross

DB MODEL: BlackjackRound
  id, userId, stakeGzo, deckJson (server-side, secret until settled),
  deckIndex, playerCards, dealerCards, splitCards,
  activeHand (0=main, 1=split), mainStakeGzo, splitStakeGzo,
  mainDoubled, splitDoubled, actions (JSON log), status,
  mainOutcome, splitOutcome, grossPayoutGzo, profitGzo, feeGzo, netPayoutGzo,
  serverSeed (revealed on settle), serverSeedHash, clientSeed, nonce

API ROUTES:
  POST /api/games/blackjack/deal    → starts round, deals initial cards
  POST /api/games/blackjack/hit     → draws card
  POST /api/games/blackjack/stand   → ends player turn, dealer plays
  POST /api/games/blackjack/double  → doubles stake, one more card
  POST /api/games/blackjack/split   → splits pair
```

---

### Hilo

**Type:** Solo, multi-step
**Max payout:** up to 10000× (compound multiplier)
**Fee:** 10% of profit
**Session:** Guess HIGHER / LOWER / SAME compared to current card, compound multiplier

```
DECK:
  Standard 52-card deck, shuffled once per round via HMAC seed.
  First card revealed; player guesses about next card.

GUESSES:
  HIGHER → next card rank is strictly higher than current
  LOWER  → next card rank is strictly lower than current
  SAME   → next card rank is equal to current (long odds)

MULTIPLIER:
  Per-guess multiplier = number of remaining cards / number that match prediction
  Compound: overall_mult × per_guess_mult on each correct guess
  Can compound to very high values with many correct guesses

STATE MACHINE:
  ACTIVE → (correct guess) → ACTIVE (multiplier grows)
  ACTIVE → (wrong guess)   → LOST
  ACTIVE → (cashout)       → CASHED_OUT

DB MODEL: HiloRound
  id, userId, stakeGzo, deckJson, deckIndex=1,
  currentMultiplier, guessHistory (JSON array of {card, guess, correct, multiplier}),
  status (ACTIVE|CASHED_OUT|LOST), grossPayoutGzo, profitGzo, feeGzo, netPayoutGzo,
  serverSeed (revealed on end), serverSeedHash, clientSeed, nonce

API ROUTES:
  POST /api/games/hilo/start    { stakeGzo } → starts round
  POST /api/games/hilo/guess    { guess: "HIGHER"|"LOWER"|"SAME" }
  POST /api/games/hilo/cashout
```

---

### Wheel

**Type:** Solo
**Max payout:** 100× (high risk mode)
**Fee:** 10% of profit

```
PARAMETERS:
  stakeGzo  → GZO amount
  riskMode  → "low" | "medium" | "high"

RNG:
  publicSeed = "wheel:{userId}"
  stopPosition = bytesToInt(HMAC bytes, 0, segmentCount-1)
  segment determined by stop position
  landedMultiplier = WHEEL_CONFIG[riskMode].segments[stopPosition].multiplier

RISK MODES:
  low:    smaller multipliers, more frequent wins, tight spread
  medium: balanced — some big wins, some losses
  high:   rare big wins (up to 100×), frequent small wins and losses

DB MODEL: WheelRound
  id, userId, stakeGzo, riskMode, configVersion,
  stopPosition, segmentIndex, segmentLabel, landedMultiplier,
  grossPayoutGzo, profitGzo, feeGzo, netPayoutGzo,
  serverSeed, serverSeedHash, clientSeed, nonce

API ROUTE: POST /api/games/wheel/spin
  Body: { stakeGzo, riskMode }
  Response: { betId, stopPosition, segmentLabel, landedMultiplier, payouts, seeds }
```

---

## 11. Authentication & User Identity

### Current: Wallet-First (Web3)

```
CONNECT WALLET FLOW (SIWE — Sign-In with Ethereum):

1. User opens app → RainbowKit "Connect Wallet" modal
2. User selects MetaMask / WalletConnect / Rainbow / etc.
3. App calls: GET /api/auth/wallet/nonce?address=0x...
   └─ Server generates random hex nonce (16 bytes)
   └─ Stores nonce in memory with 5-minute TTL
   └─ Returns SIWE message (EIP-4361 format)

4. App prompts wallet to sign the SIWE message
   (user sees "Sign in to Gamzo" in MetaMask)

5. App calls: POST /api/auth/wallet/verify
   Body: { address, message, signature }
   └─ Server verifies signature using viem.verifyMessage()
   └─ Validates nonce from message (consumes and deletes it)
   └─ If valid: upsert User in DB with walletAddress = address.toLowerCase()
   └─ Returns { ok: true, userId, address }

6. App stores session (NextAuth JWT) keyed by walletAddress
   └─ All subsequent API calls include session cookie
   └─ session.user.id = user.id (DB cuid)

SIWE Message Format (EIP-4361):
  "gamzo.app wants you to sign in with your Ethereum account:\n"
  "0xABCDEF...\n\n"
  "Sign in to Gamzo — Provably Fair Games\n\n"
  "URI: https://gamzo.app\n"
  "Version: 1\n"
  "Chain ID: 80002\n"
  "Nonce: a3f9e1b2...\n"
  "Issued At: 2026-03-18T12:00:00.000Z"
```

### Legacy: Email/Password (retained for migration)

```
Endpoint: POST /api/auth/signup  → creates user with email + bcrypt hash
Endpoint: POST /api/auth/[...nextauth] → NextAuth Credentials provider

Rate limiting: 5 attempts per 15 minutes per email (in-memory map)
Session: JWT strategy, { id: user.id } embedded in token

Note: End-user UI now shows only "Connect Wallet".
Email/password backend remains for existing accounts during migration period.
```

### User Identity Model

```
DB User row:
  id            → internal CUID (used in all FK relations)
  walletAddress → "0x..." lowercase (unique, null for legacy users)
  email         → still required (wallet users get placeholder email)
  chainId       → chain at last wallet sign-in
  lastSeenAt    → updated each wallet auth
  name          → "0xABCD…1234" (auto-generated from address)
  passwordHash  → null for wallet users
```

---

## 12. Database Schema

All models are in `prisma/schema.prisma`. Key models:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  User                                                                    │
│  id (CUID) · email (unique) · walletAddress (unique) · name             │
│  passwordHash · chainId · lastSeenAt · createdAt · updatedAt            │
│  ──────────────────────────────────────────────────────────────────────  │
│  Relations: WalletBalance · LedgerEntry · GameBet · CoinflipMatch       │
│             PlayerSeedState · MinesRound · RouletteRound                 │
│             BlackjackRound · HiloRound · WheelRound                     │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  WalletBalance                                                           │
│  userId (PK) · balance (Decimal 18,8)                                   │
│  Singleton per user — the player's in-game credit balance               │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  LedgerEntry                                                             │
│  id · userId · type (DEPOSIT|WITHDRAWAL|BET_PLACED|BET_WON|BET_REFUND) │
│  amount · balanceBefore · balanceAfter · reference · createdAt          │
│  Purpose: immutable audit trail of all balance changes                  │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  PlayerSeedState                                                         │
│  userId (PK) · serverSeed (secret) · serverSeedHash · clientSeed        │
│  nonce · prevServerSeedHash · updatedAt                                 │
│  Purpose: commit-reveal seed management for provably fair system        │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  GameBet                                                                 │
│  id · userId · gameType (enum) · stakeGzo · status (PENDING|SETTLED)   │
│  idempotencyKey (unique) · createdAt · settledAt · referenceId          │
│  serverSeedHash · serverSeedRevealed · clientSeed · nonce · publicSeed  │
│  resultJson (game-specific outcome data)                                 │
│  grossPayoutGzo · profitGzo · feeGzo · netPayoutGzo                     │
│  ── Web3 fields ──────────────────────────────────────────────────────  │
│  onchainRoundId (bytes32) · txHash · settleTxHash · chainId             │
│  blockNumber · contractAddress                                           │
│  Purpose: one row per settled bet (all 8 games share this model)        │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  CoinflipMatch                                                           │
│  id · playerAId · playerBId · wager · playerAChoice (HEADS|TAILS)      │
│  outcome · winnerId · status (PENDING|ACTIVE|COMPLETED|CANCELLED)       │
│  createdAt · resolvedAt                                                  │
│  ── Relation ─────────────────────────────────────────────────────────  │
│  CoinflipCommit: matchId+userId (unique), commitHash, seed (revealed)   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  HouseTreasury (singleton, id="house")                                  │
│  balanceGzo (Decimal 18,8) · updatedAt                                  │
│  ── HouseLedger ──────────────────────────────────────────────────────  │
│  type: INITIAL_FUND|BET_IN|BET_OUT|FEE|TOPUP                           │
│  amountGzo · balanceBefore · balanceAfter · reference · createdAt       │
│  Purpose: offchain accounting shadow of the on-chain TreasuryVault      │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  MinesRound · RouletteRound · BlackjackRound · HiloRound · WheelRound  │
│  Session-based game state (each has its own model for mid-game state)   │
│  All share: serverSeed · serverSeedHash · clientSeed · nonce · status  │
└─────────────────────────────────────────────────────────────────────────┘

GameType enum: COINFLIP | DICE | PLINKO | KENO |
               MINES | ROULETTE | BLACKJACK | HILO | WHEEL
```

### Prisma Client Pattern

Due to the `@prisma/adapter-pg` adapter pattern, all Prisma calls use `(prisma as any)`:

```typescript
import { prisma } from "@/lib/prisma";

// Correct:
const user = await (prisma as any).user.findUnique({ where: { id } });

// Also correct in transactions:
const result = await (prisma as any).$transaction(async (tx: any) => {
  const bet = await (tx as any).gameBet.create({ data: { ... } });
  return bet;
});
```

---

## 13. API Routes Reference

### Authentication
```
GET  /api/auth/wallet/nonce?address=0x...  → SIWE nonce + message
POST /api/auth/wallet/verify               → { address, message, signature } → session
POST /api/auth/signup                      → { email, password } → creates user
POST /api/auth/[...nextauth]               → NextAuth handler
```

### Fairness / Seeds
```
GET  /api/fairness/seeds              → { serverSeedHash, clientSeed, nonce }
POST /api/fairness/seeds              → { clientSeed } → updates client seed
POST /api/fairness/seeds/rotate       → rotates serverSeed, returns revealedSeed
```

### CoinFlip
```
POST /api/coinflip/create             → { stake, side } → { matchId, commitHash }
POST /api/coinflip/join               → { matchId } → { outcome, winner, payouts }
GET  /api/coinflip/matches            → list of PENDING matches
GET  /api/coinflip/match/:matchId     → single match details
GET  /api/coinflip/history            → user's coinflip history
POST /api/coinflip/verify             → { matchId } → HMAC audit data
```

### Solo Games — all return { betId, result, won, payouts, seeds, rngVersion }
```
POST /api/games/dice/bet              → { stakeGzo, target, mode }
POST /api/games/plinko/bet            → { stakeGzo, rows, risk }
POST /api/games/keno/bet              → { stakeGzo, picks: number[] }
POST /api/games/roulette/spin         → { bets: [{area, stake}] }
POST /api/games/wheel/spin            → { stakeGzo, riskMode }
```

### Session Games
```
POST /api/games/mines/start           → { stakeGzo, mineCount }
POST /api/games/mines/reveal          → { tileIndex }
POST /api/games/mines/cashout
POST /api/games/mines/forfeit
GET  /api/games/mines/current
GET  /api/games/mines/history

POST /api/games/blackjack/deal        → { stakeGzo }
POST /api/games/blackjack/hit
POST /api/games/blackjack/stand
POST /api/games/blackjack/double
POST /api/games/blackjack/split       → { splitStake }

POST /api/games/hilo/start            → { stakeGzo }
POST /api/games/hilo/guess            → { guess: "HIGHER"|"LOWER"|"SAME" }
POST /api/games/hilo/cashout
```

### History
```
GET  /api/history?game=DICE&page=2    → { bets[], total, page, pageSize, totalPages }
  game: optional filter (COINFLIP|DICE|PLINKO|...)
  page: 1-indexed, 100 records per page
  Returns both GameBet and CoinflipMatch records, merged and sorted
```

### Admin
```
GET  /api/admin/treasury              → Bearer AUTH_SECRET → house balance + ledger
POST /api/admin/treasury              → Bearer AUTH_SECRET → top-up treasury
```

---

## 14. Frontend Architecture

### Component Hierarchy

```
layout.tsx  (server component)
  └─ Web3Providers (client: wagmi + RainbowKit + TanStack Query)
       └─ SessionProvider (client: NextAuth)
            └─ NavBar (client)
            │    └─ WalletButton (client: ConnectButton + GZOBalancePill)
            └─ <page> (varies)
```

### Game Page Template

Every game page follows this structure:

```
<NetworkGuard>                    ← requires wallet connected + correct chain
  <GameHeader />                  ← game name, description, accent color
  <OnchainBadge />                ← contract address + explorer link
  <GZOBalanceDisplay />           ← live GZO balance (from useGZOBalance)

  <BetForm>
    <ApproveGZO spender={ADDRESSES.treasuryVault} requiredAmount={stakeWei}>
      <PlaceBetButton />          ← only shown when allowance is sufficient
    </ApproveGZO>
  </BetForm>

  <TxStatus />                    ← pending / confirming / success / error
  <GameResult />                  ← animated outcome display
  <FairnessWidget />              ← server seed hash / client seed / nonce
  <TransactionHistory game="DICE" /> ← recent bets widget
  <OtherGames exclude="dice" />   ← carousel of other games
</NetworkGuard>
```

### Key Client Components

| Component | Purpose |
|---|---|
| `WalletButton` | RainbowKit ConnectButton + live GZO balance pill + wrong network warning |
| `NetworkGuard` | Blocks game if not connected or wrong chain; shows connect/switch UI |
| `ApproveGZO` | Wraps any action requiring GZO approval; shows approve button if needed |
| `TxStatus` | Renders pending/confirming/success/error with explorer link |
| `FairnessWidget` | Shows server seed hash (pre-bet) or revealed seed (post-bet) |
| `TransactionHistory` | Shows recent 15 bets for a specific game; links to /history |

### Design System

All styling uses inline styles (no CSS classes except `.card`, `.btn-primary`, `.btn-ghost`, `.nav-link`).

```
Color palette:
  Background:   #0a0a1a (page), #0d0d1f (card)
  Border:       #2a2a50
  Text:         #f0f0ff (primary), #8888aa (muted), #555577 (dim)
  Green accent: #00ff9d (wins, coinflip, primary action)
  Blue accent:  #00d4ff (dice, info)
  Gold:         #ffd700 (plinko, pending)
  Red:          #ff4d4d (loss states)
  Purple:       #a855f7 (keno)
  Pink:         #ff3d7a (mines)
  Fuchsia:      #e879f9 (roulette)
  Teal:         #14b8a6 (blackjack)
  Periwinkle:   #818cf8 (hilo)
  Amber:        #fb923c (wheel)

Font: Geist (sans) + Geist Mono (code/numbers)
```

---

## 15. Web3 Integration Layer

### Files

```
src/lib/web3/
├── config.ts              ← wagmi getDefaultConfig({ chains, transports })
├── contracts.ts           ← ABIs + ADDRESSES (read from deployed-addresses.json)
├── deployed-addresses.json ← auto-written by contracts/scripts/deploy.ts
└── hooks/
    ├── useGZOBalance.ts   ← useReadContract for balanceOf + allowance
    ├── useApproval.ts     ← useWriteContract for approve, faucet
    └── useCoinFlip.ts     ← useWriteContract for createMatch, joinMatch, cancel
                              useReadContract for getMatch (polls until settled)
```

### Wallet Config (`config.ts`)

```typescript
// Reads NEXT_PUBLIC_CHAIN_ID from env:
//   31337 → Hardhat local (http://127.0.0.1:8545)
//   80002 → Polygon Amoy (https://rpc-amoy.polygon.technology)

// WalletConnect project ID from NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
// Supports: MetaMask, WalletConnect, Rainbow, Coinbase Wallet, and more
```

### Contract Addresses (`deployed-addresses.json`)

This file is auto-written by the deploy script (`contracts/scripts/deploy.ts`).
It is imported at build time in `contracts.ts`. After any re-deploy, rebuild the Next.js app.

```json
{
  "network": "localhost",
  "chainId": 31337,
  "deployedAt": "2026-03-18T...",
  "gzoToken": "0x...",
  "treasuryVault": "0x...",
  "gameRegistry": "0x...",
  "randomnessCoordinator": "0x...",
  "coinFlipGame": "0x...",
  "diceGame": "0x..."
}
```

### Hook Usage Pattern

```typescript
// ── Read balance ──────────────────────────────────────────────────────
const { raw, formatted, isLoading } = useGZOBalance();
// raw: BigInt, formatted: "10,000.00"

// ── Read allowance ────────────────────────────────────────────────────
const { raw: allowance } = useGZOAllowance(ADDRESSES.treasuryVault);

// ── Approve (write) ───────────────────────────────────────────────────
const { approve, isPending, isConfirming, isSuccess, error } = useApproveGZO(spender);
approve();              // approves MaxUint256
approve(parseEther("1000")); // approves specific amount

// ── Place bet (coinflip create) ───────────────────────────────────────
const { createMatch, hash, isPending, isConfirming, isSuccess, roundId } = useCreateMatch();
createMatch(parseEther("100"), 0 /* HEADS */);
// roundId available after isSuccess === true (extracted from MatchCreated event log)

// ── Tx status helper ──────────────────────────────────────────────────
const status = useTxStatus({ isPending, isConfirming, isSuccess, error });
// status: "idle" | "pending" | "confirming" | "success" | "error"
<TxStatus status={status} hash={hash} error={error} />
```

---

## 16. House Treasury & Accounting

### On-chain (TreasuryVault.sol)

```
TreasuryVault holds ALL game GZO.
Initial seed: 1,000,000 GZO minted directly to vault on deploy.

Accounting events (emitted by vault):
  StakeLocked  → received from player
  PayoutSent   → sent to winner (net amount)
  FeeCollected → amount retained as house profit
  StakeRefunded → loser's stake absorbed into house profit
  BankrollDeposited → admin top-up
  BankrollWithdrawn → fee withdrawal to operator

Solvency invariant:
  vault.canPay(amount) = gzoToken.balanceOf(vault) >= totalLocked + amount
  This is checked before every bet acceptance.
```

### Off-chain (HouseTreasury DB shadow)

```
HouseTreasury (singleton, id="house"):
  balanceGzo: starts at 1,000,000

HouseLedger types:
  INITIAL_FUND → seeding event
  BET_IN       → player stake received
  BET_OUT      → gross payout sent to winner
  FEE          → fee re-credited to house after BET_OUT
  TOPUP        → admin manual top-up

Example for a winning bet (stake=100, gross=198, fee=9, net=189):
  BET_IN  +100  (player stakes)
  BET_OUT -198  (house pays gross to winner)
  FEE      +9   (house re-credits fee)
  Net house change: 100 - 198 + 9 = -89 (house "lost" 89 GZO on this round)

Example for a losing bet (stake=100, gross=0):
  BET_IN  +100  (player stakes, house keeps all)
  Net house change: +100

Accessing:
  GET /api/admin/treasury    → requires Bearer AUTH_SECRET header
  POST /api/admin/treasury   → top-up
```

---

## 17. Security Model

### Smart Contract Security

```
┌─────────────────────────────────────────────────────────────────────────┐
│ REENTRANCY PROTECTION                                                    │
│ All state-changing functions in TreasuryVault and game contracts use a  │
│ nonReentrant modifier (inline reentrancy guard, OZ v5 compatible).      │
│ Checks-Effects-Interactions (CEI) pattern: state updated before         │
│ external calls.                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ ACCESS CONTROL                                                           │
│ Every privileged function has an onlyRole() guard.                      │
│ GAME_ROLE is only granted to deployed game contracts, not EOAs.         │
│ Only the RandomnessCoordinator can call fulfillRandomness() on games.   │
│ Only the Chainlink VRF coordinator can call rawFulfillRandomWords().    │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ UPGRADEABILITY SAFETY                                                    │
│ All contracts use UUPS (EIP-1822). _authorizeUpgrade requires           │
│ UPGRADER_ROLE. Storage layout must be preserved across upgrades.        │
│ Use OpenZeppelin storage gap pattern if adding new storage variables.   │
│ Never add storage before existing variables in upgraded implementations. │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ SOLVENCY CHECK                                                           │
│ treasury.canPay(amount) called before every bet acceptance.             │
│ Prevents house from accepting bets it cannot pay out.                   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ SAFE TOKEN TRANSFERS                                                     │
│ All ERC-20 interactions use OpenZeppelin SafeERC20 (safeTransfer,       │
│ safeTransferFrom). Handles non-standard ERC-20 tokens that return false │
│ instead of reverting.                                                    │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ PAUSABILITY                                                              │
│ TreasuryVault and all game contracts implement Pausable.                 │
│ Emergency pause stops all bet placement and payouts.                    │
│ Admin can pause individually (e.g. pause CoinFlip while Dice continues).│
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ NO SELF-JOIN                                                             │
│ CoinFlipGame.joinMatch() reverts if msg.sender == playerA.             │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ DOUBLE-SETTLEMENT PREVENTION                                             │
│ DiceGame.Round.settled bool — revert if already settled.                │
│ CoinflipGame.Match.status check — must be ACTIVE to settle.            │
│ TreasuryVault.lockedByGame check — cannot pay more than was locked.    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Application Security

```
SIWE AUTH:
  - Nonce is single-use (deleted after verification)
  - Nonce expires in 5 minutes
  - Signature verified via viem.verifyMessage() (no home-grown crypto)
  - ECSDA recovery of address confirmed to match claimed address

API PROTECTION:
  - All game routes check authenticated session (auth() from NextAuth)
  - Admin routes require Bearer AUTH_SECRET header

INPUT VALIDATION:
  - All API inputs validated with Zod schemas
  - Stake ranges enforced (minStake / maxStake on contracts, also in API)
  - Seed management uses DB transactions for atomicity

RATE LIMITING:
  - Login: 5 attempts / 15 min per email (in-memory)
  - Consider Redis for multi-instance deployments

SEED SECURITY:
  - serverSeed never returned via API during active round
  - Only serverSeedHash is shown pre-bet
  - Seed revealed only after round settlement
  - Seed rotation happens inside a DB transaction with bet settlement
```

---

## 18. Local Development Setup

### Prerequisites

```bash
# Node.js 20+, PostgreSQL running
node --version    # v20+
psql --version    # 14+
```

### Step 1: Clone and install

```bash
git clone <repo>
cd Casino
npm install              # Next.js app dependencies
cd contracts && npm install  # Hardhat dependencies
cd ..
```

### Step 2: Database setup

```bash
brew install postgresql@16    # if not installed
brew services start postgresql@16
createdb gamzo
psql gamzo -c "CREATE USER gamzo WITH PASSWORD 'gamzo_dev_password';"
psql gamzo -c "GRANT ALL PRIVILEGES ON DATABASE gamzo TO gamzo;"
npm run db:migrate            # runs Prisma migrations
npm run db:seed               # seeds HouseTreasury with 1,000,000 GZO
```

### Step 3: Environment

```bash
cp .env.example .env.local
# Edit .env.local:
DATABASE_URL="postgresql://gamzo:gamzo_dev_password@localhost:5432/gamzo"
NEXTAUTH_SECRET="any-32-char-random-string"
NEXTAUTH_URL="http://localhost:3000"
AUTH_SECRET="any-32-char-random-string"
NEXT_PUBLIC_CHAIN_ID="31337"
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="your_id"  # optional for localhost
```

### Step 4: Start Hardhat node

```bash
cd contracts
npx hardhat node
# Leave this running in a terminal
# Shows 20 test accounts with private keys
```

### Step 5: Deploy contracts

```bash
# In a new terminal
cd contracts
npx hardhat run scripts/deploy.ts --network localhost
# ✅ Deploys 6 contracts
# ✅ Writes src/lib/web3/deployed-addresses.json automatically
```

### Step 6: Configure MetaMask

```
Network name: Hardhat Local
RPC URL: http://127.0.0.1:8545
Chain ID: 31337
Currency symbol: ETH
```

Import Hardhat Account #0:
`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

### Step 7: Get test GZO

Connect wallet on the app → the `faucet()` function mints 10,000 GZO per call.
Or via Hardhat console:
```javascript
npx hardhat console --network localhost
const gzo = await ethers.getContractAt("GZOToken", "<GZO_ADDRESS_FROM_JSON>")
await gzo.faucet()  // mints 10,000 to your wallet
```

### Step 8: Start app

```bash
cd ..   # back to Casino root
npx next dev
# Open http://localhost:3000
```

---

## 19. Polygon Amoy Deployment

### Deployed Addresses (localhost — updated by deploy script)

| Contract | Proxy Address |
|---|---|
| GZOToken | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| TreasuryVault | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` |
| GameRegistry | `0x0165878A594ca255338adfa4d48449f69242Eb8F` |
| RandomnessCoordinator | `0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6` |
| CoinFlipGame | `0x610178dA211FEF7D417bC0e6FeD39F05609AD788` |
| DiceGame | `0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0` |

### Amoy Deployment Steps

#### 1. Get testnet MATIC
[Polygon Faucet](https://faucet.polygon.technology/) — needs 0.5+ MATIC in deployer wallet.

#### 2. Create Chainlink VRF subscription
1. Go to [vrf.chain.link](https://vrf.chain.link/) → select Polygon Amoy
2. Create subscription → fund with testLINK
3. Copy the subscription ID

#### 3. Set contracts/.env
```bash
DEPLOYER_PRIVATE_KEY=0x_your_key
AMOY_RPC_URL=https://rpc-amoy.polygon.technology
VRF_COORDINATOR=0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf
VRF_KEY_HASH=0x816bedba8a50b294e5cbd47842baf240c2385f2eaf719edbd4f250a137a8c899
VRF_SUBSCRIPTION_ID=<your_id>
POLYGONSCAN_API_KEY=<optional>
```

#### 4. Deploy
```bash
cd contracts
npm run deploy:amoy
# ✅ Auto-writes src/lib/web3/deployed-addresses.json
```

#### 5. Add VRF consumer
In the Chainlink VRF dashboard: add `randomnessCoordinator` address as a consumer.

#### 6. Fund treasury
```bash
npx hardhat console --network amoy
const gzo = await ethers.getContractAt("GZOToken", "<GZO_ADDR>")
const treasury = await ethers.getContractAt("TreasuryVault", "<VAULT_ADDR>")
await gzo.mint("<VAULT_ADDR>", ethers.parseEther("1000000"))
```

#### 7. Update frontend env
```bash
NEXT_PUBLIC_CHAIN_ID=80002
```

#### 8. Rebuild and deploy
```bash
npx next build
```

---

## 20. Adding a New Game

### Step 1: Smart contract

Create `contracts/contracts/games/NewGame.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IGame.sol";
import "../core/TreasuryVault.sol";
import "../core/RandomnessCoordinator.sol";
import "../libraries/GameMath.sol";
// ... AccessControl, Pausable, UUPS, ReentrancyGuard imports

contract NewGame is /* same pattern as DiceGame */, IGame {
    bytes32 public constant GAME_ID = keccak256("NEWGAME");
    // ... declare storage, events, placeBet, fulfillRandomness, gameName, gameId
}
```

### Step 2: Deploy and register

In `contracts/scripts/deploy.ts`, add:
```typescript
const NewGame = await ethers.getContractFactory("NewGame");
const newGame = await upgrades.deployProxy(NewGame, [admin, treasuryAddr, coordinatorAddr, min, max]);
const newGameAddr = await newGame.getAddress();

await treasury.grantRole(GAME_ROLE, newGameAddr);
await coordinator.grantRole(GAME_ROLE, newGameAddr);
await registry.registerGame(keccak256("NEWGAME"), newGameAddr);
```

### Step 3: ABI + address

In `src/lib/web3/contracts.ts`, add:
```typescript
export const NEWGAME_ABI = [ /* ... */ ] as const;
// Add to ADDRESSES:
newGame: deployedAddresses.newGame as `0x${string}`,
```

### Step 4: wagmi hook

Create `src/lib/web3/hooks/useNewGame.ts`:
```typescript
export function usePlaceNewGameBet() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  function placeBet(stake: bigint, /* params */) {
    writeContract({ address: ADDRESSES.newGame, abi: NEWGAME_ABI, functionName: "placeBet", args: [stake, /* ... */] });
  }
  return { placeBet, hash, isPending, ... };
}
```

### Step 5: Backend logic

Create `src/lib/newgame.ts` — RNG computation using existing `hmacSha256Bytes` primitives.
Create `src/app/api/games/newgame/bet/route.ts` — following the same pattern as dice or keno.

### Step 6: Frontend page

Create `src/app/newgame/page.tsx` — following the NetworkGuard + ApproveGZO + TxStatus pattern.

### Step 7: Register in GameType enum

In `prisma/schema.prisma`, add `NEWGAME` to the `GameType` enum.
Run `npm run db:migrate -- --name add_newgame`.

### Step 8: Add to navigation

- `src/components/NavBar.tsx` → add to `SINGLE_PLAYER_GAMES`
- `src/components/GamesGrid.tsx` → add to `GAMES`
- `src/components/OtherGames.tsx` → add to `ALL_GAMES`
- `src/components/HomeGamesGrid.tsx` → add to `GAMES`
- `src/components/GameIcons.tsx` → add an SVG icon component

---

## 21. Upgrading Contracts

### UUPS Upgrade Pattern

UUPS (Universal Upgradeable Proxy Standard, EIP-1822):
- The proxy is a minimal EIP-1822 proxy that delegates all calls to the implementation
- The implementation contract stores the upgrade logic
- `_authorizeUpgrade(newImpl)` is called on the EXISTING implementation, so access control is enforced
- The implementation address is stored in a specific storage slot (EIP-1967)

### Storage Layout Rules

**CRITICAL:** When upgrading, you MUST:
1. Never remove or reorder existing storage variables
2. Never change the type of an existing storage variable
3. Only ADD new variables at the END of the storage layout

```solidity
// V1:
contract DiceGame {
  TreasuryVault public treasury;  // slot 0
  uint256 public minStake;        // slot 1
  uint256 public maxStake;        // slot 2
}

// V2 — CORRECT:
contract DiceGame {
  TreasuryVault public treasury;  // slot 0 (unchanged)
  uint256 public minStake;        // slot 1 (unchanged)
  uint256 public maxStake;        // slot 2 (unchanged)
  uint256 public newVariable;     // slot 3 (new at end) ✅
}

// V2 — WRONG:
contract DiceGame {
  uint256 public newVariable;     // BREAKS slot 0 ❌
  TreasuryVault public treasury;
  ...
}
```

### Upgrade Script

```typescript
// scripts/upgrade.ts
import { ethers, upgrades } from "hardhat";
import addresses from "../deployed-addresses.json";

async function main() {
  const DiceGameV2 = await ethers.getContractFactory("DiceGame");
  // upgrades.upgradeProxy validates storage layout automatically
  const upgraded = await upgrades.upgradeProxy(
    addresses.diceGame,
    DiceGameV2,
    { kind: "uups" }
  );
  console.log("Upgraded DiceGame at:", await upgraded.getAddress());
}
main().catch(console.error);
```

### Using Storage Gaps (best practice for future-proof upgrades)

Add at end of contracts that may be upgraded with new storage:
```solidity
// Reserve storage slots for future upgrades
uint256[50] private __gap;
```

---

## 22. Testing Strategy

### Smart Contract Tests (Hardhat + Chai)

```
contracts/test/
  GZOToken.test.ts       → 5 tests: name/symbol, mint, faucet, role restriction, upgrade
  TreasuryVault.test.ts  → 4 tests: stake, payout, access control, upgrade
  CoinFlipGame.test.ts   → 7 tests: deploy state, create, full VRF settle flow,
                           cancel, stake limits, no self-join, upgrade

Total: 16 tests, 3 suites — all passing

Run: cd contracts && npx hardhat test
```

### MockVRFCoordinator

In tests, instead of real Chainlink VRF, we use `MockVRFCoordinator`:
```typescript
// In test:
await mockVRF.fulfillRandomWords(
  vrfRequestId,
  coordinatorAddress,
  2   // even = HEADS
);
// This instantly calls rawFulfillRandomWords → game.fulfillRandomness
```

### Frontend Tests (Jest + ts-jest)

```
src/__tests__/
  rng.test.ts          → 35 tests: HMAC determinism, float distribution, backward compat
  settlement.test.ts   → 21 tests: fee calculation edge cases
  coinflip.test.ts     → existing coinflip logic
  mines.test.ts        → 41 tests: mine generation, multiplier math
  ... (other game tests)

Total: 342 tests, 14 suites

Run: npx jest
```

### Integration Test Checklist (manual)

```
□ Connect wallet via MetaMask on localhost
□ GZO balance shows in navbar
□ Network prompt shows on wrong chain
□ Faucet mints 10,000 GZO
□ Approve GZO on CoinFlip → tx confirmed in MetaMask
□ Create match → roundId returned, match appears in list
□ Second wallet joins match → VRF auto-fulfills on Hardhat (mock VRF)
□ Match settles → winner receives 1.9× stake
□ TxStatus shows pending → confirming → success
□ History page shows the settled bet
□ Verify page shows server seed + HMAC verification
```

---

## 23. Environment Variables Reference

### Next.js App (`.env.local`)

```bash
# ── Database ──────────────────────────────────────────────────────────
DATABASE_URL="postgresql://gamzo:password@localhost:5432/gamzo"

# ── NextAuth ───────────────────────────────────────────────────────────
NEXTAUTH_SECRET="min-32-char-secret"    # openssl rand -base64 32
NEXTAUTH_URL="http://localhost:3000"    # or https://yourapp.com
AUTH_SECRET="min-32-char-secret"        # same value as NEXTAUTH_SECRET

# ── App ────────────────────────────────────────────────────────────────
NODE_ENV="development"
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# ── Web3 ───────────────────────────────────────────────────────────────
NEXT_PUBLIC_CHAIN_ID="31337"            # 31337=Hardhat, 80002=Amoy
NEXT_PUBLIC_AMOY_RPC="https://rpc-amoy.polygon.technology"
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="your_project_id"
# Get WalletConnect project ID: https://cloud.walletconnect.com
```

### Hardhat Contracts (`contracts/.env`)

```bash
# ── Deployer ───────────────────────────────────────────────────────────
DEPLOYER_PRIVATE_KEY=0x_your_private_key

# ── Network ────────────────────────────────────────────────────────────
AMOY_RPC_URL=https://rpc-amoy.polygon.technology

# ── Chainlink VRF v2.5 (Polygon Amoy) ─────────────────────────────────
VRF_COORDINATOR=0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf
VRF_KEY_HASH=0x816bedba8a50b294e5cbd47842baf240c2385f2eaf719edbd4f250a137a8c899
VRF_SUBSCRIPTION_ID=<your_subscription_id>

# ── Verification ───────────────────────────────────────────────────────
POLYGONSCAN_API_KEY=<optional>
REPORT_GAS=false
```

---

## 24. Glossary

| Term | Definition |
|---|---|
| **GZO** | Gamezo token — the single in-game currency. ERC-20, 18 decimals. |
| **Provably Fair** | A cryptographic guarantee that game outcomes cannot be manipulated by the house. Uses HMAC-SHA256 commitment scheme. |
| **serverSeed** | Secret random bytes chosen by the server before a bet. Committed as a SHA-256 hash and revealed after settlement. |
| **clientSeed** | Player-chosen entropy string. Mixed into every outcome via HMAC. The house cannot predict it, so cannot manipulate outcomes. |
| **publicSeed** | Deterministically derived (e.g. `dice:userId`). No secrets needed to reconstruct. |
| **nonce** | Integer that increments after each settled bet. Ensures different outcomes per round even with the same seeds. |
| **HMAC-SHA256** | Hash-based Message Authentication Code. Used here as a pseudorandom function: HMAC(serverSeed, data) produces 32 deterministic bytes. |
| **commit-reveal** | Cryptographic pattern: party A commits to a value by publishing hash(value). Later reveals the value. Others can verify hash(revealed) = commitment. Prevents retroactive manipulation. |
| **UUPS** | Universal Upgradeable Proxy Standard (EIP-1822). A proxy pattern where the upgrade logic lives in the implementation, not the proxy. Lighter than Transparent Proxy. |
| **VRF** | Verifiable Random Function. Chainlink's VRF provides onchain randomness with a cryptographic proof that the output is unpredictable and unbiasable. |
| **TreasuryVault** | Smart contract that holds all GZO in escrow during game rounds. Acts as the financial escrow layer between players and game contracts. |
| **GameRegistry** | Smart contract that maps game IDs to deployed game contract addresses. Controls which games are active. |
| **RandomnessCoordinator** | Smart contract that abstracts Chainlink VRF. Games request randomness through it; it forwards fulfillments back to games. |
| **GAME_ROLE** | AccessControl role granted to game contracts. Required to call `lockStake`, `payout`, `refundLoss` on TreasuryVault, and `requestRandomness` on the Coordinator. |
| **SIWE** | Sign-In with Ethereum (EIP-4361). Standard for wallet-based authentication using a signed message instead of a password. |
| **Hardhat** | Ethereum development environment. Used for compiling, testing, and deploying Gamzo smart contracts. |
| **wagmi** | React hooks library for Ethereum. Provides `useReadContract`, `useWriteContract`, `useAccount`, etc. |
| **viem** | TypeScript library for EVM. Low-level client used by wagmi. Replaces ethers.js. |
| **RainbowKit** | UI component library for wallet connection. Provides the "Connect Wallet" modal with support for MetaMask, WalletConnect, Rainbow, etc. |
| **CEI** | Checks-Effects-Interactions. Smart contract security pattern: validate first, update state second, call external contracts third. Prevents reentrancy attacks. |
| **Polygon Amoy** | Polygon's testnet (chainId 80002). Used for pre-production testing with test MATIC and test tokens. |
| **SafeERC20** | OpenZeppelin wrapper for ERC-20 token calls. Handles tokens that return `false` instead of reverting on failure. |
| **idempotencyKey** | Unique string stored in GameBet that prevents duplicate bet records. `game:userId:nonce` ensures only one DB row per settled round. |
| **Settlement** | The final accounting of a round: grossPayout, profit, fee, netPayout. Computed by `settle()` in both `settlement.ts` (offchain) and `GameMath.sol` (onchain). |
| **Bankroll** | House treasury balance. Must remain > 0 for the house to accept new bets. Solvency is checked before every `lockStake`. |

---

*End of Knowledge Transfer Document*

*For questions, see the inline code documentation in each file.*
*For deployment issues, see [DEPLOYMENT.md](DEPLOYMENT.md).*
*For architecture decisions, see git history and commit messages.*
