/**
 * House Treasury operations.
 *
 * The house acts as escrow for PvP matches:
 *   - BET_IN  : house receives player stake
 *   - BET_OUT : house pays gross pot to winner
 *   - FEE     : house re-credits the retained win-fee
 *   - TOPUP   : admin / seed top-up
 *
 * All functions that take `tx` must be called inside an existing
 * Prisma $transaction to guarantee atomicity with wallet operations.
 */

import { prisma } from "@/lib/prisma";
import { WIN_FEE_RATE } from "@/lib/settlement";

export const HOUSE_ID = "house";
export const HOUSE_INITIAL_BALANCE = 1_000_000; // seed funding in GZO

export const HouseLedgerType = {
  INITIAL_FUND: "INITIAL_FUND",
  BET_IN: "BET_IN",
  BET_OUT: "BET_OUT",
  BET_REFUND: "BET_REFUND",
  FEE: "FEE",
  TOPUP: "TOPUP",
} as const;
export type HouseLedgerType = (typeof HouseLedgerType)[keyof typeof HouseLedgerType];

// ── In-transaction helpers ────────────────────────────────────────────────────

/** Credit house treasury inside an existing transaction. Returns new balance. */
export async function creditHouseTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  amountGzo: number,
  type: HouseLedgerType,
  reference?: string
): Promise<number> {
  const house = await tx.houseTreasury.findUniqueOrThrow({ where: { id: HOUSE_ID } });
  const before = Number(house.balanceGzo);
  const after = before + amountGzo;

  await tx.houseTreasury.update({
    where: { id: HOUSE_ID },
    data: { balanceGzo: String(after) },
  });

  await tx.houseLedger.create({
    data: {
      houseId: HOUSE_ID,
      type,
      amountGzo: String(amountGzo),
      balanceBefore: String(before),
      balanceAfter: String(after),
      reference: reference ?? null,
    },
  });

  return after;
}

/** Debit house treasury inside an existing transaction. Throws if insufficient. */
export async function debitHouseTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  amountGzo: number,
  type: HouseLedgerType,
  reference?: string
): Promise<number> {
  const house = await tx.houseTreasury.findUniqueOrThrow({ where: { id: HOUSE_ID } });
  const before = Number(house.balanceGzo);
  if (before < amountGzo) {
    throw new Error(`House treasury insufficient: have ${before} GZO, need ${amountGzo} GZO`);
  }
  const after = before - amountGzo;

  await tx.houseTreasury.update({
    where: { id: HOUSE_ID },
    data: { balanceGzo: String(after) },
  });

  await tx.houseLedger.create({
    data: {
      houseId: HOUSE_ID,
      type,
      amountGzo: String(amountGzo),
      balanceBefore: String(before),
      balanceAfter: String(after),
      reference: reference ?? null,
    },
  });

  return after;
}

/**
 * Verify the house can cover the maximum liability before accepting a new bet.
 *
 * For PvP coinflip: house needs at least 0.9 × stake in treasury at creation
 * time so it can cover netPayout after holding both escrow deposits.
 *
 * minRequired = stake × (1 − feeRate)  [= max net outflow from house per bet]
 */
export async function ensureHouseSolvencyTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  stakeGzo: number
): Promise<void> {
  const house = await tx.houseTreasury.findUnique({ where: { id: HOUSE_ID } });
  if (!house) throw new Error("House treasury not initialised — run prisma db seed first");

  const balance = Number(house.balanceGzo);
  const minRequired = stakeGzo * (1 - WIN_FEE_RATE); // 0.9 × stake

  if (balance < minRequired) {
    throw new Error(
      `House treasury too low: balance ${balance} GZO, need ≥ ${minRequired} GZO to accept this bet`
    );
  }
}

// ── Standalone helpers ────────────────────────────────────────────────────────

/** Return current house treasury balance (GZO). */
export async function getHouseBalance(): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const house = await (prisma as any).houseTreasury.findUnique({ where: { id: HOUSE_ID } });
  return house ? Number(house.balanceGzo) : 0;
}

/** Fetch recent house ledger entries (newest first). */
export async function getHouseLedger(take = 50) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma as any).houseLedger.findMany({
    where: { houseId: HOUSE_ID },
    orderBy: { createdAt: "desc" },
    take,
  });
}
