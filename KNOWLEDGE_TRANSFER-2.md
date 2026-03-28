# GamZO Casino — Knowledge Transfer 2: Onchain Architecture

## Overview

The casino was upgraded from session-based API routes to a fully onchain smart contract system deployed on Polygon Amoy. All game logic, randomness, and payouts are now provably fair and verified on-chain.

## Smart Contract Stack

- **Network**: Polygon Amoy (testnet), chainId 80002
- **Standard**: OpenZeppelin v5 UUPS Upgradeable contracts
- **Randomness**: Chainlink VRF v2 (via `RandomnessCoordinator` proxy)
- **Token**: GZO (ERC-20, 18 decimals)
- **Treasury**: `TreasuryVault` — single liquidity pool for all games

## Contract Architecture

```
GZOToken (ERC-20 + Mintable)
    └── TreasuryVault (lockStake / payout / refundLoss / canPay)
            └── RandomnessCoordinator (requestRandomness / fulfillRandomness)
                    └── Games (GAME_ROLE grantees):
                            CoinFlipGame   — PvP match
                            DiceGame       — roll under target
                            WheelGame      — weighted wheel spin
                            RouletteGame   — European roulette (37 numbers)
                            PlinkoGame     — ball drop with path bits
                            KenoGame       — 10-of-40 draw
                            MinesGame      — session: reveal safe tiles
                            BlackjackGame  — session: card game vs house
                            HiloGame       — session: hi/lo card guessing
```

## Key Patterns

### UUPS Upgrade Safety
- State variables MUST NOT have inline initial values (OpenZeppelin rejects them)
- Arrays must be declared without initializers and assigned in `initialize()`
- Example: `WheelGame._weights` and `WheelGame._mults` are assigned in `initialize()`, not inline

### VRF Flow (VRF Games: Dice, Wheel, Roulette, Plinko, Keno)
1. Player calls game function → `treasury.lockStake()` → `randomness.requestRandomness()` → emits event
2. Chainlink/MockVRF calls `coordinator.fulfillRandomness()` → forwards to game
3. Game's `fulfillRandomness(vrfRequestId, uint256[] randomWords)` settles the round
4. `treasury.payout()` or `treasury.refundLoss()` releases funds

### Session Games (Mines, Blackjack, Hilo)
- Round status: PENDING (0) → ACTIVE (1) → CASHED_OUT (2) / LOST (3) / REFUNDED (4)
- VRF seed is used to derive deck/mine positions (Fisher-Yates shuffle)
- Player submits cards/tiles with proof, contract verifies using stored `deckSeed`

### Treasury Accounting
- `lockStake(gameId, roundId, player, amount)` — transfers from player, increments `totalLocked`
- `payout(gameId, roundId, player, net, fee)` — decrements locked, sends net to player, retains fee
- `refundLoss(gameId, roundId, player, amount)` — decrements locked (house keeps stake)
- `canPay(amount)` — returns `balance >= totalLocked + amount`

### Deck Shuffle (Mines/Blackjack/Hilo)
Fisher-Yates using `keccak256(abi.encodePacked(seed, i))` for randomness at each step.
**Critical**: use `abi.encodePacked` (not `abi.encode`) — different byte lengths → different hashes.
JavaScript equivalent:
```typescript
const packed = ethers.solidityPacked(["uint256", "uint8"], [seed, i]);
const hash = ethers.keccak256(packed);
const j = Number(BigInt(hash) % BigInt(i + 1));
```

## Front-End Architecture

### Web3 Integration Stack
- **wagmi v2** + **viem** for contract interactions
- **RainbowKit** for wallet connection
- **`NetworkGuard`** component ensures Polygon Amoy before any game action
- **`ApproveGZO`** component handles ERC-20 allowance before contract calls
- **`TxStatus`** component shows tx hash + confirmation state

### Game Page Pattern
```tsx
// 1. Wallet state
const { address, isConnected } = useAccount();
const { data: balance } = useGZOBalance(address);

// 2. Contract write
const { writeContract, data: txHash } = useWriteContract();
const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: txHash });

// 3. Poll round result
const [roundId, setRoundId] = useState<`0x${string}` | null>(null);
const { data: round } = useReadContract({
  ...gameContract,
  functionName: "getRound",
  args: [roundId],
  query: { refetchInterval: (q) => (q.state.data?.settled ? false : 3000) },
});

// 4. Show VRF pending
if (roundId && !round?.settled) return <VRFPending />;
```

### Hook Files
All game hooks follow the pattern in `src/lib/web3/hooks/`:
- `useCoinFlip.ts` — `useCreateMatch`, `useJoinMatch`, `useCoinFlipMatch`
- `useDice.ts` — `usePlaceDiceBet`, `useDiceRound`
- `useWheel.ts` — `useSpinWheel`, `useWheelRound`
- `useRoulette.ts` — `useSpinRoulette`, `useRouletteRound`
- `usePlinko.ts` — `useDropBall`, `usePlinkoRound`
- `useKeno.ts` — `usePlaceKenoBet`, `useKenoRound`
- `useMines.ts` — `useStartMinesRound`, `useMinesCashout`, `useMinesLose`, `useMinesRound`, `useActiveMinesRound`, `useMinePositions`
- `useBlackjack.ts` — `useStartBlackjackRound`, `useSettleBlackjack`, `useLockDouble`, `useBlackjackRound`, `useActiveBlackjackRound`, `useGetDeckOrder`
- `useHilo.ts` — `useStartHiloRound`, `useHiloCashout`, `useHiloLose`, `useHiloRound`, `useActiveHiloRound`, `useGetHiloDeck`

## Test Suite

**107 tests, 13 suites — all passing**

| Suite | Tests | Key scenarios |
|-------|-------|---------------|
| GZOToken | 4 | mint, transfer, upgradeable |
| TreasuryVault | 4 | lock, payout, access control, upgrade |
| CoinFlipGame | 12 | PvP flow, heads/tails payout |
| DiceGame | 8 | win/lose/fee/revert paths |
| WheelGame | 8 | 3 risk modes, segments, pause |
| RouletteGame | 10 | straight/even-money/multi-wager bets |
| PlinkoGame | 10 | 3 row configs, bin validation, fee |
| KenoGame | 10 | pick validation, draw uniqueness, match count |
| MinesGame | 10 | safe tile reveal, mine detection, cashout |
| BlackjackGame | 8 | card verification, double, push |
| HiloGame | 9 | HIGHER/LOWER guesses, multiplier, cashout |

### Test Patterns

**MockVRFCoordinator**: Sequential IDs starting at 1 per fresh deployment.
Track with `let nextVrfId = 1n; beforeEach(() => { nextVrfId = 1n; })`.

**VRF fulfillment**: Single `uint256 randomWord` (NOT an array):
```typescript
// CORRECT:
await mockVRF.fulfillRandomWords(vrfReqId, coordinatorAddr, randomWord);
// WRONG (causes INVALID_ARGUMENT error):
await mockVRF.fulfillRandomWords(vrfReqId, coordinatorAddr, [randomWord]);
```

**Bankroll sizing**: MinesGame worst case (5 mines, 20 reveals) = 53,130× multiplier.
Test bankroll must be ≥ 10M GZO for 100 GZO stake tests.

## Contract Addresses (Polygon Amoy)

See `contracts/deployed-addresses.json` for the authoritative addresses.
Mirrored in `src/lib/web3/contracts.ts` → `ADDRESSES` object.

## Game Math Reference

| Game | Formula | Notes |
|------|---------|-------|
| Dice | `gross = stake * 9900 / targetScaled` | targetScaled ∈ [101, 9800] → roll in [0,9999] |
| Wheel | weighted segment table per risk mode | 3 modes, 6 segments, total weight=54 |
| Roulette | straight=35×, even=1×, dozen=2×, col=2× | European (37 numbers, 0-36) |
| Plinko | lookup table [rows][risk][bin] | rows ∈ {8,12,16}, risk ∈ {0,1,2} |
| Keno | `C(picks,matches)/C(40-picks,10-matches)` | picks ∈ [1,10], 10 drawn from 40 |
| Mines | `C(25,safePicks)/C(25-mines,safePicks)` | safePicks progressive reveal |
| Blackjack | 3:2 on natural BJ, 1:1 hit win, push=refund | standard dealer logic |
| HiLo | `product of (remaining/candidates)` per correct guess | 52-card Fisher-Yates |

Fee: 10% of profit only (`fee = (gross - stake) / 10`, floor; no fee if gross ≤ stake).

## Deployment

```bash
cd contracts
npx hardhat run scripts/deploy.ts --network amoy
# Addresses written to deployed-addresses.json
# Copy to src/lib/web3/deployedAddresses.json if needed
```

## Running Tests

```bash
cd contracts
npx hardhat test                    # all 107 tests
npx hardhat test test/DiceGame.test.ts  # specific suite
```

## Wallet-Based Authentication System

### Overview
Users are identified by their Ethereum wallet address (no email/password required). The wallet address is the unique user identifier. Authentication uses SIWE (Sign-In with Ethereum) — the user signs a one-time nonce message to prove wallet ownership.

### Flow
1. User opens RainbowKit modal → connects wallet (MetaMask, etc.)
2. App fetches a one-time nonce: `GET /api/wallet/nonce?address=0x...`
3. App asks user to sign SIWE message via `signMessage` (wagmi)
4. App posts signature: `POST /api/wallet/verify` → server verifies, upserts user, sets httpOnly cookie
5. App reads session: `GET /api/wallet/me` → returns `{ id, walletAddress, name, email, createdAt }`
6. User disconnects wallet → `POST /api/wallet/logout` → cookie cleared → user state reset

### API Routes (`src/app/api/wallet/`)
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/wallet/nonce` | GET | Generate one-time nonce (5-min TTL, stored in-memory) |
| `/api/wallet/verify` | POST | Verify SIWE signature, upsert user, set session cookie |
| `/api/wallet/logout` | POST | Expire session cookie |
| `/api/wallet/me` | GET | Return current user from cookie session |
| `/api/wallet/profile` | PATCH | Update name/email (email must be valid format if provided) |

### Key Files
- `src/lib/walletSession.ts` — HMAC-SHA256 signed `wallet_session` httpOnly cookie; `createSession`, `getSession`, `clearSession`
- `src/lib/nonceStore.ts` — In-memory nonce Map with 5-min TTL; `generateNonce`, `consumeNonce`
- `src/lib/prismaClient.ts` — Singleton Prisma client with PrismaPg adapter
- `src/lib/web3/hooks/useWalletAuth.ts` — React hook: connect → nonce → signMessage → verify → restore session on mount
- `src/contexts/WalletAuthContext.tsx` — React context `WalletAuthProvider` + `useWalletUser()` hook
- `src/components/WalletButton.tsx` — RainbowKit `ConnectButton` wrapper with profile menu, "Signing in..." state, error toast
- `src/components/ProfileModal.tsx` — Edit name + optional email; read-only wallet address display

### Session Cookie
```
Name:     wallet_session
Value:    base64(payload).base64(hmac-sha256 signature)
HttpOnly: true
SameSite: Lax
MaxAge:   7 days
Secret:   AUTH_SECRET env var
```

### Database Schema
User model keyed on `walletAddress` (unique, lowercase-normalized):
```prisma
model User {
  id            String   @id @default(cuid())
  walletAddress String   @unique  // Ethereum address, lowercase
  name          String?
  email         String?  @unique  // Optional
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```
Email is optional (`String?`) — migration `20260319000001_make_email_optional`.

### Edge Cases Handled
- Wallet switch mid-session: `useAccount` `address` change triggers re-auth
- Sign rejection: caught, error toast shown, session stays on previous user
- Nonce replay: nonces consumed on use, expire after 5 min
- Duplicate wallet: `upsert` on `walletAddress` — returns existing user
- Duplicate email: 409 Conflict returned from `/api/wallet/profile`
- Session expired: `/api/wallet/me` returns 401 → user state cleared

### Web3 Config Notes
- `ssr: false` in `wagmiConfig` prevents SSR/hydration mismatch
- Per-component `QueryClient` via `useState` avoids shared state between renders
- `reconnectOnMount={false}` on `WagmiProvider` prevents stale reconnect loops
- WalletConnect fallback project ID `"3a8170812b534d0ff9d794f19a901d64"` allows MetaMask to work without a real WC ID
- `@metamask/sdk@0.33.1` required as peer dep for wagmi v3's `@wagmi/connectors`
