# Game Migration Guide — Custodial + On-Chain VRF Flow
> Reference for converting each game from direct wallet escrow to custodial DB balance + Chainlink VRF

---

## The Core Pattern (established with Dice)

**Before:** User wallet → `approve` → `transferFrom` → smart contract escrow → VRF → payout to wallet
**After:**  DB balance debit → House wallet calls `placeBetFor(player, stake, ...)` → VRF → DB balance credit

The smart contract still handles **all game logic and randomness**. Only the token movement changes — funds tracked in DB, not escrowed from user wallet.

---

## Migration Status

| Game | Contract | `placeBetFor`? | API Route | Frontend | Status |
|------|----------|:--------------:|-----------|----------|--------|
| **Dice** | `DiceGame.sol` | ✅ Done | `/api/games/dice/bet` + `/api/games/dice/status` | `dice/page.tsx` | ✅ **COMPLETE** |
| CoinFlip | `CoinFlipGame.sol` | ❌ | `/api/coinflip/*` | `coinflip/page.tsx` | 🔲 Pending |
| Plinko | `PlinkoGame.sol` | ❌ | — | `plinko/page.tsx` | 🔲 Pending |
| Wheel | `WheelGame.sol` | ❌ | — | `wheel/page.tsx` | 🔲 Pending |
| Roulette | `RouletteGame.sol` | ❌ | — | `roulette/page.tsx` | 🔲 Pending |
| Keno | `KenoGame.sol` | ❌ | — | `keno/page.tsx` | 🔲 Pending |
| Mines | `MinesGame.sol` | ❌ | — | `mines/page.tsx` | 🔲 Pending |
| Blackjack | `BlackjackGame.sol` | ❌ | — | `blackjack/page.tsx` | 🔲 Pending |
| HiLo | `HiloGame.sol` | ❌ | — | `hilo/page.tsx` | 🔲 Pending |
| Crash/Limbo | `CrashGame.sol` | ❌ | — | — | 🔲 Pending |
| Aviator | — | N/A (server-side) | `/api/games/aviator/*` | `aviator/page.tsx` | 🔲 Review |

---

## Step-by-Step Migration for Each Game

### Step 1 — Modify the Solidity contract

Open `contracts/contracts/games/[GameName].sol` and make these changes:

**A. Add `custodial` flag to the Round/Match struct**
```solidity
// Add at the END of the struct (preserves storage layout for existing rounds)
bool custodial;  // v2: true = funds tracked in DB, no on-chain token transfers
```

**B. Add `placeBetFor` (or equivalent) function**
```solidity
/// @notice Custodial bet — OPERATOR places on behalf of player, no token pull from wallet.
function placeBetFor(address player, uint256 stake, /* game-specific params */)
    external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant returns (bytes32 roundId)
{
    require(player != address(0), "invalid player");
    require(stake >= minStake && stake <= maxStake, "stake out of range");
    // game-specific validation...
    require(treasury.canPay(grossPayout), "house insolvent");

    // Use "game-c" prefix to distinguish custodial rounds
    roundId = keccak256(abi.encodePacked("game-c", player, block.timestamp, stake, /* params */));

    rounds[roundId] = Round({
        player:    player,
        stake:     stake,
        // ...other fields...
        settled:   false,
        custodial: true
    });

    uint256 vrfId = randomness.requestRandomness(GAME_ID, roundId, address(this));
    vrfToRound[vrfId] = roundId;
    emit BetPlaced(roundId, player, stake, /* params */);
}
```

**C. Split `fulfillRandomness` for custodial vs non-custodial**
```solidity
function fulfillRandomness(uint256 vrfRequestId, uint256[] memory randomWords) external override {
    // ... compute roll/outcome as before ...

    if (!r.custodial) {
        // ORIGINAL: real token transfers through treasury
        if (r.won) { treasury.payout(...); }
        else        { treasury.refundLoss(...); }
    } else {
        // CUSTODIAL: just record result — no token transfers
        // backend will credit DB balance when it sees the settled round
        if (r.won) {
            // compute and store netPayout, fee (same math, no transfer)
        }
    }

    emit RoundSettled(...);
}
```

> ⚠️ **Storage layout rule:** Always add `bool custodial` at the END of the struct.
> Booleans pack into existing slots — never moves existing field offsets.

---

### Step 2 — Write the upgrade script

Copy `contracts/scripts/upgradeDice.ts` and adjust:

```typescript
// contracts/scripts/upgrade[GameName].ts
const GAME_PROXY = "0x...";  // from deployed-addresses.json

// Same pattern as upgradeDice.ts:
// 1. forceImport proxy
// 2. upgradeProxy
// 3. grantRole(OPERATOR_ROLE, houseWallet)
```

Run:
```bash
cd contracts
npx hardhat run scripts/upgrade[GameName].ts --network amoy
```

---

### Step 3 — Update `src/lib/web3/contracts.ts`

Add the new function to the game's ABI entry:
```typescript
export const [GAME]_ABI = [
  // existing entries...
  { name: "placeBetFor", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "player", type: "address" },
      { name: "stake",  type: "uint256" },
      // game-specific params
    ],
    outputs: [{ name: "roundId", type: "bytes32" }] },
  // Add custodial: bool to getRound struct output
] as const;
```

---

### Step 4 — Update `src/lib/viemServer.ts`

Add a minimal ABI for the game (only what the server needs):
```typescript
export const [GAME]_ABI = [
  { name: "placeBetFor", ... },
  { name: "getRound", ... },   // include custodial field
] as const;
```

---

### Step 5 — Write/update the API route: `/api/games/[game]/bet`

**Template pattern (from dice):**

```typescript
export async function POST(req: NextRequest) {
  // 1. Auth — require walletAddress (SIWE session)
  const authUser = await getAuthUser(req);
  if (!authUser?.walletAddress) return 401/400;

  // 2. Validate body
  body = schema.parse(await req.json());

  // 3. DB transaction: debit stake
  await prisma.$transaction(async (tx) => {
    checkBalance(tx, userId, stake);
    debitWallet(tx, userId, stake);         // WalletBalance -=  stake
    createLedgerEntry(tx, BET_PLACED);      // LedgerEntry
    createGameBet(tx, PENDING);             // GameBet status=PENDING
  });

  // 4. On-chain call via house wallet
  const { result: roundId } = await publicClient.simulateContract({
    functionName: "placeBetFor",
    args: [walletAddress, stakeWei, ...gameParams],
    account: houseAccount,
  });
  const txHash = await walletClient.writeContract(request);

  // 5. If on-chain fails → refund DB (compensating transaction)
  //    update GameBet with roundId, txHash

  // 6. Return { roundId, betId, txHash }
}
```

---

### Step 6 — Write the status/polling API: `/api/games/[game]/status`

For **instant-settle games** (Dice, Plinko, Wheel, Roulette, Keno, CoinFlip):
```typescript
// GET /api/games/[game]/status?roundId=0x...
// Polls getRound() → when settled, credits win to DB (idempotent)
// Returns: { settled: false } | { settled: true, won, netPayoutGzo, balanceAfter, ... }
```

For **multi-step games** (Mines, Blackjack, HiLo) — see special cases below.

**Idempotency guard:**
```typescript
// Always check GameBet.status first
if (existingBet.status === "SETTLED") return cached result;
// Only process when status === "PENDING"
// Use $transaction to atomically: credit balance + mark SETTLED
```

---

### Step 7 — Update the frontend page

**Changes needed:**
1. Replace `useWriteContract` + `useWaitForTransactionReceipt` with `fetch("/api/games/[game]/bet")`
2. After bet placed, store `pendingRoundId` in state
3. Add polling `useEffect` (every 3s) calling `/api/games/[game]/status?roundId=...`
4. AtomLoader text → "Awaiting Chainlink VRF…"
5. Update Provably Fair section → show roundId + Chainlink VRF badge
6. Remove `NetworkGuard`, `ApproveGZO`, `useTxStatus` if present
7. Balance from `useDBBalance()` (already done for most pages)

**Polling pattern (copy from dice/page.tsx):**
```typescript
const [pendingRoundId, setPendingRoundId] = useState<string | null>(null);

useEffect(() => {
  if (!pendingRoundId) return;
  const timer = setInterval(async () => {
    const res = await fetch(`/api/games/[game]/status?roundId=${pendingRoundId}`);
    const data = await res.json();
    if (data.settled) {
      clearInterval(timer);
      setPendingRoundId(null);
      setResult(data);
      setIsRolling(false);
      refetchBalance();
    }
  }, 3_000);
  return () => clearInterval(timer);
}, [pendingRoundId]);
```

---

## Game-Specific Notes

### CoinFlip
- **Contract:** Two-player match (`createMatch` + `joinMatch`) — both players have wallets
- **Migration:** Add `createMatchFor(address playerA, ...)` + `joinMatchFor(address playerB, ...)`
- Both debits happen from DB; house calls contract for both sides
- Existing `CoinflipMatch` DB table can be reused

### Plinko
- **Contract:** Single bet, same pattern as Dice
- **Function to add:** `placeBetFor(address player, uint256 stake, uint8 rows, uint8 risk)`
- Polling endpoint: same instant-settle pattern

### Wheel
- **Contract:** Single bet
- **Function to add:** `spinFor(address player, uint256 stake, uint8 riskMode)`
- Polling endpoint: same instant-settle pattern

### Roulette
- **Contract:** Multiple bets in one spin (array of betTypes + stakes)
- **Function to add:** `spinFor(address player, uint8[] betTypes, uint256[] stakes)`
- Total stake = sum of all stakes array values (deduct from DB as one amount)

### Keno
- **Contract:** Pick numbers, VRF draws 10
- **Function to add:** `placeBetFor(address player, uint256 stake, uint8[] picks)`
- Polling endpoint: same instant-settle pattern

### Mines
- **Contract:** Multi-step (start → reveal tiles → cashout/lose)
- **Complexity:** HIGH — VRF only used for mine placement; subsequent moves are synchronous
- **Migration:**
  - `startRoundFor(address player, uint256 stake, uint8 mineCount)` — debit DB, call contract
  - `revealTile` / `cashout` / `loseRound` — call contract via house wallet, credit DB on cashout
  - Need to track active round per player in DB

### Blackjack
- **Contract:** Multi-step (deal → hit/stand/double/split → settle)
- **Complexity:** HIGH — VRF used for deck shuffle; player actions are server-side
- **Note:** Current implementation already uses server-side deck (DB-only). Check if on-chain Blackjack is still needed or can stay server-side.

### HiLo
- **Contract:** Multi-step (start → guess higher/lower → cashout/lose)
- **Complexity:** HIGH — similar to Mines
- **Note:** Current implementation uses server-side RNG. Same question as Blackjack.

### Aviator
- **Contract:** None — already server-side custodial
- **Status:** Already custodial (DB balance, server-side RNG). No migration needed.

### Crash/Limbo
- **Contract:** `CrashGame.sol` exists but check if any page uses it
- May be implemented server-side already

---

## Conversion Order (recommended)

Start with simpler single-bet VRF games, leave multi-step for last:

1. ✅ **Dice** — done (template for all others)
2. 🔲 **Plinko** — same pattern as dice
3. 🔲 **Wheel** — same pattern as dice
4. 🔲 **Roulette** — same pattern, array bets
5. 🔲 **Keno** — same pattern, array picks
6. 🔲 **CoinFlip** — two-player variant
7. 🔲 **Mines** — multi-step, needs careful state management
8. 🔲 **Blackjack** — multi-step, assess if on-chain worth it
9. 🔲 **HiLo** — multi-step, assess if on-chain worth it

---

## Key Rules (do not deviate)

1. **Always add `bool custodial` at the END of the struct** — never in the middle
2. **Always use `"game-c"` prefix in roundId hash** — distinguishes custodial from wallet-placed rounds
3. **Debit DB before on-chain call** — if on-chain fails, refund DB (compensating tx)
4. **Settlement is idempotent** — check `GameBet.status === "PENDING"` before crediting
5. **House wallet pays MATIC gas** — ensure `HOUSE_PRIVATE_KEY` wallet has MATIC
6. **`walletAddress` required** — SIWE login required to play (email-only users need wallet)
7. **VRF wait is normal** — Chainlink on Amoy takes 1–3 min; frontend polls with 8 min timeout
8. **No treasury token transfers for custodial rounds** — `fulfillRandomness` skips `payout()`/`refundLoss()`

---

## Files Reference

```
contracts/
  contracts/games/DiceGame.sol          ← DONE — template for all games
  scripts/upgradeDice.ts                ← DONE — template for upgrade scripts

src/
  lib/viemServer.ts                     ← add each game's ABI here
  lib/web3/contracts.ts                 ← add placeBetFor to each game's ABI
  app/api/games/dice/bet/route.ts       ← DONE — template for bet routes
  app/api/games/dice/status/route.ts    ← DONE — template for status routes
  app/dice/page.tsx                     ← DONE — template for frontend polling
```
