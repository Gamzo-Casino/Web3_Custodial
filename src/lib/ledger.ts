import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/generated/prisma/enums";

export { LedgerEntryType };

export const AIRDROP_AMOUNT = 1000; // credits given on signup

/**
 * Credit a user's wallet inside a serializable Prisma transaction.
 * Returns the new balance as a number.
 * Throws if the wallet does not exist.
 */
export async function creditWallet(
  userId: string,
  amount: number,
  type: LedgerEntryType,
  reference?: string
): Promise<number> {
  if (amount <= 0) throw new Error("Credit amount must be positive");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma as any).$transaction(async (tx: any) => {
    const wallet = await tx.walletBalance.findUniqueOrThrow({
      where: { userId },
    });

    const before = Number(wallet.balance);
    const after = before + amount;

    await tx.walletBalance.update({
      where: { userId },
      data: { balance: String(after) },
    });

    await tx.ledgerEntry.create({
      data: {
        userId,
        type,
        amount: String(amount),
        balanceBefore: String(before),
        balanceAfter: String(after),
        reference: reference ?? null,
      },
    });

    return after;
  });
}

/**
 * Debit a user's wallet inside a serializable Prisma transaction.
 * Throws if insufficient balance, preventing negative balances.
 * Returns the new balance as a number.
 */
export async function debitWallet(
  userId: string,
  amount: number,
  type: LedgerEntryType,
  reference?: string
): Promise<number> {
  if (amount <= 0) throw new Error("Debit amount must be positive");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma as any).$transaction(async (tx: any) => {
    const wallet = await tx.walletBalance.findUniqueOrThrow({
      where: { userId },
    });

    const before = Number(wallet.balance);
    if (before < amount) {
      throw new Error(`Insufficient balance: have ${before}, need ${amount}`);
    }

    const after = before - amount;

    await tx.walletBalance.update({
      where: { userId },
      data: { balance: String(after) },
    });

    await tx.ledgerEntry.create({
      data: {
        userId,
        type,
        amount: String(amount),
        balanceBefore: String(before),
        balanceAfter: String(after),
        reference: reference ?? null,
      },
    });

    return after;
  });
}

/**
 * Initialize wallet + airdrop ledger entry for a new user.
 * Must be called inside an existing transaction or standalone.
 */
export async function initializeWallet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  userId: string,
  airdropAmount: number = AIRDROP_AMOUNT
): Promise<void> {
  await tx.walletBalance.create({
    data: {
      userId,
      balance: String(airdropAmount),
    },
  });

  await tx.ledgerEntry.create({
    data: {
      userId,
      type: LedgerEntryType.DEPOSIT,
      amount: String(airdropAmount),
      balanceBefore: "0",
      balanceAfter: String(airdropAmount),
      reference: "signup-airdrop",
    },
  });
}

/**
 * Fetch paginated ledger entries for a user, newest first.
 */
export async function getLedgerEntries(userId: string, take = 20) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma as any).ledgerEntry.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
  });
}
