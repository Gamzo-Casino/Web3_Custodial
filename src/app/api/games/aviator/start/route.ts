import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { creditHouseTx, HouseLedgerType } from "@/lib/house";
import { getBetSeedsTx, incrementNonceTx, rotateSeedTx } from "@/lib/seedManager";
import {
  computeAviatorPublicSeed,
  computeAviatorFlyAwayPoint,
  AVIATOR_VERSION,
} from "@/lib/aviator";
import { z } from "zod";

const bodySchema = z.object({
  stakeGzo: z.number().int().min(1).max(100_000),
  /** Optional auto-cashout multiplier [1.01, 10000] — if set, server auto-settles */
  autoCashoutAt: z.number().min(1.01).max(10000.0).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { stakeGzo: stake, autoCashoutAt } = body;

  try {
    // Reject if an active round already exists
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (prisma as any).aviatorRound.findFirst({
      where: { userId, status: "FLYING" },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Active Aviator round already exists. Cash out or wait for crash." },
        { status: 400 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (prisma as any).$transaction(async (tx: any) => {
      // ── 1. Get player's current seed state ────────────────────────────────
      const seeds = await getBetSeedsTx(tx, userId);
      const { serverSeed, serverSeedHash, clientSeed, nonce } = seeds;

      // ── 2. Compute fly-away point deterministically ───────────────────────
      const publicSeed = computeAviatorPublicSeed(userId);
      const flyAwayPoint = computeAviatorFlyAwayPoint(
        serverSeed, clientSeed, publicSeed, nonce
      );

      // ── 3. House solvency check ──────────────────────────────────────────
      const house = await tx.houseTreasury.findUniqueOrThrow({ where: { id: "house" } });
      const houseBalance = Number(house.balanceGzo);
      if (houseBalance < stake) {
        throw new Error("House treasury too low");
      }

      // ── 4. Debit player wallet (stake) ───────────────────────────────────
      const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
      const balanceBefore = Number(wallet.balance);
      if (balanceBefore < stake) throw new Error("Insufficient balance");
      const balanceAfterStake = balanceBefore - stake;

      await tx.walletBalance.update({
        where: { userId },
        data: { balance: String(balanceAfterStake) },
      });

      await tx.ledgerEntry.create({
        data: {
          userId,
          type: LedgerEntryType.BET_PLACED,
          amount: String(stake),
          balanceBefore: String(balanceBefore),
          balanceAfter: String(balanceAfterStake),
          reference: null,
        },
      });

      // ── 5. House receives stake (escrow) ─────────────────────────────────
      await creditHouseTx(tx, stake, HouseLedgerType.BET_IN);

      // ── 6. Rotate seed — commit/reveal guarantee ─────────────────────────
      const { revealedSeed } = await rotateSeedTx(tx, userId);

      // ── 7. Increment nonce ───────────────────────────────────────────────
      await incrementNonceTx(tx, userId);

      // ── 8. Create AviatorRound ───────────────────────────────────────────
      const now = new Date();
      const idempotencyKey = `aviator:${userId}:${nonce}`;
      const round = await tx.aviatorRound.create({
        data: {
          userId,
          stakeGzo: String(stake),
          status: "FLYING",
          flyAwayPoint,
          autoCashoutAt: autoCashoutAt ?? null,
          startedAt: now,
          serverSeed: revealedSeed,
          serverSeedHash,
          clientSeed,
          nonce,
          publicSeed,
          rngVersion: AVIATOR_VERSION,
          idempotencyKey,
        },
      });

      // ── 9. Audit log ─────────────────────────────────────────────────────
      await tx.auditLog.create({
        data: {
          userId,
          action: "aviator.start",
          entity: "AviatorRound",
          entityId: round.id,
          metadata: {
            stake,
            autoCashoutAt: autoCashoutAt ?? null,
            nonce,
            rngVersion: AVIATOR_VERSION,
          },
        },
      });

      return {
        roundId: round.id,
        stakeGzo: stake,
        startedAt: now.toISOString(),
        autoCashoutAt: autoCashoutAt ?? null,
        serverSeedHash,
        clientSeed,
        nonce,
        publicSeed,
        balanceAfter: balanceAfterStake,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    if (msg === "Insufficient balance" || msg.startsWith("House treasury")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("aviator/start error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
