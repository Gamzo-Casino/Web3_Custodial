import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { settle } from "@/lib/settlement";
import { debitHouseTx, creditHouseTx, HouseLedgerType } from "@/lib/house";
import {
  getMultiplierAtTime,
  computeAviatorGrossPayout,
  AVIATOR_VERSION,
} from "@/lib/aviator";

export const dynamic = "force-dynamic";

/**
 * Returns the player's active Aviator round state.
 * Also detects crash & auto-cashout server-side and settles if needed.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const round = await (prisma as any).aviatorRound.findFirst({
      where: { userId, status: "FLYING" },
      orderBy: { createdAt: "desc" },
    });

    if (!round) return NextResponse.json({ round: null });

    const now = new Date();
    const startedAt = new Date(round.startedAt);
    const elapsedMs = now.getTime() - startedAt.getTime();
    const currentMultiplier = getMultiplierAtTime(elapsedMs);
    const flyAwayPoint = Number(round.flyAwayPoint);
    const stake = Number(round.stakeGzo);
    const autoCashoutAt = round.autoCashoutAt ? Number(round.autoCashoutAt) : null;

    // ── Check auto-cashout (before crash check) ─────────────────────────
    if (autoCashoutAt && currentMultiplier >= autoCashoutAt && autoCashoutAt <= flyAwayPoint) {
      // Auto-cashout triggers — settle as win at the auto-cashout multiplier
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (prisma as any).$transaction(async (tx: any) => {
        // Re-fetch inside tx to prevent race
        const freshRound = await tx.aviatorRound.findUniqueOrThrow({ where: { id: round.id } });
        if (freshRound.status !== "FLYING") return null; // already settled

        const cashMult = autoCashoutAt;
        const grossPayout = computeAviatorGrossPayout(stake, cashMult);
        const { profitGzo, feeGzo, netPayoutGzo } = settle(stake, grossPayout);

        const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
        const balanceBefore = Number(wallet.balance);
        const balanceAfter = balanceBefore + netPayoutGzo;

        await tx.walletBalance.update({ where: { userId }, data: { balance: String(balanceAfter) } });
        await tx.ledgerEntry.create({
          data: {
            userId, type: LedgerEntryType.BET_WON,
            amount: String(netPayoutGzo),
            balanceBefore: String(balanceBefore),
            balanceAfter: String(balanceAfter),
            reference: round.id,
          },
        });

        await debitHouseTx(tx, grossPayout, HouseLedgerType.BET_OUT, round.id);
        if (feeGzo > 0) await creditHouseTx(tx, feeGzo, HouseLedgerType.FEE, round.id);

        await tx.aviatorRound.update({
          where: { id: round.id },
          data: {
            status: "CASHED_OUT", cashoutMultiplier: cashMult, settledAt: now,
            grossPayoutGzo: String(grossPayout), profitGzo: String(profitGzo),
            feeGzo: String(feeGzo), netPayoutGzo: String(netPayoutGzo),
          },
        });

        await tx.gameBet.create({
          data: {
            userId, gameType: "AVIATOR", stakeGzo: freshRound.stakeGzo,
            status: "SETTLED", idempotencyKey: `aviator-settle:${round.id}`,
            serverSeedHash: freshRound.serverSeedHash, serverSeedRevealed: freshRound.serverSeed,
            clientSeed: freshRound.clientSeed, nonce: freshRound.nonce,
            publicSeed: freshRound.publicSeed, referenceId: round.id, settledAt: now,
            resultJson: {
              outcome: "CASHED_OUT", flyAwayPoint, cashoutMultiplier: cashMult,
              autoCashout: true, rngVersion: AVIATOR_VERSION,
            },
            grossPayoutGzo: String(grossPayout), profitGzo: String(profitGzo),
            feeGzo: String(feeGzo), netPayoutGzo: String(netPayoutGzo),
          },
        });

        return { cashMult, grossPayout, profitGzo, feeGzo, netPayoutGzo, balanceAfter };
      });

      if (result) {
        return NextResponse.json({
          round: {
            id: round.id,
            stakeGzo: stake,
            status: "CASHED_OUT",
            flyAwayPoint,
            cashoutMultiplier: result.cashMult,
            autoCashoutAt,
            startedAt: round.startedAt.toISOString(),
            elapsedMs,
            currentMultiplier: result.cashMult,
            grossPayoutGzo: result.grossPayout,
            profitGzo: result.profitGzo,
            feeGzo: result.feeGzo,
            netPayoutGzo: result.netPayoutGzo,
            balanceAfter: result.balanceAfter,
            serverSeed: round.serverSeed,
            serverSeedHash: round.serverSeedHash,
            clientSeed: round.clientSeed,
            nonce: round.nonce,
          },
        });
      }
    }

    // ── Check if crashed ────────────────────────────────────────────────
    if (currentMultiplier >= flyAwayPoint) {
      // Crash! Settle as loss
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).$transaction(async (tx: any) => {
        const freshRound = await tx.aviatorRound.findUniqueOrThrow({ where: { id: round.id } });
        if (freshRound.status !== "FLYING") return; // already settled

        await tx.aviatorRound.update({
          where: { id: round.id },
          data: {
            status: "CRASHED", settledAt: now,
            grossPayoutGzo: "0", profitGzo: String(-stake),
            feeGzo: "0", netPayoutGzo: "0",
          },
        });

        await tx.gameBet.create({
          data: {
            userId, gameType: "AVIATOR", stakeGzo: freshRound.stakeGzo,
            status: "SETTLED", idempotencyKey: `aviator-settle:${round.id}`,
            serverSeedHash: freshRound.serverSeedHash, serverSeedRevealed: freshRound.serverSeed,
            clientSeed: freshRound.clientSeed, nonce: freshRound.nonce,
            publicSeed: freshRound.publicSeed, referenceId: round.id, settledAt: now,
            resultJson: {
              outcome: "CRASHED", flyAwayPoint, cashoutMultiplier: null,
              rngVersion: AVIATOR_VERSION,
            },
            grossPayoutGzo: "0", profitGzo: String(-stake),
            feeGzo: "0", netPayoutGzo: "0",
          },
        });
      });

      return NextResponse.json({
        round: {
          id: round.id,
          stakeGzo: stake,
          status: "CRASHED",
          flyAwayPoint,
          cashoutMultiplier: null,
          autoCashoutAt,
          startedAt: round.startedAt.toISOString(),
          elapsedMs,
          currentMultiplier,
          serverSeed: round.serverSeed,
          serverSeedHash: round.serverSeedHash,
          clientSeed: round.clientSeed,
          nonce: round.nonce,
        },
      });
    }

    // ── Still flying ────────────────────────────────────────────────────
    return NextResponse.json({
      round: {
        id: round.id,
        stakeGzo: stake,
        status: "FLYING",
        autoCashoutAt,
        startedAt: round.startedAt.toISOString(),
        elapsedMs,
        currentMultiplier,
        serverSeedHash: round.serverSeedHash,
        clientSeed: round.clientSeed,
        nonce: round.nonce,
        // flyAwayPoint and serverSeed are NEVER exposed during flight
      },
    });
  } catch (err) {
    console.error("aviator/current error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
