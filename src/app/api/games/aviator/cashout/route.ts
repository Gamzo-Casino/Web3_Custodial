import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { debitHouseTx, creditHouseTx, HouseLedgerType } from "@/lib/house";
import { settle } from "@/lib/settlement";
import {
  computeAviatorGrossPayout,
  getMultiplierAtTime,
  AVIATOR_VERSION,
} from "@/lib/aviator";
import { z } from "zod";

const bodySchema = z.object({
  roundId: z.string().min(1),
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

  const { roundId } = body;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const round = await tx.aviatorRound.findUniqueOrThrow({ where: { id: roundId } });

      if (round.userId !== userId) throw new Error("Not your round");
      if (round.status !== "FLYING") throw new Error("Round is not in flight");

      // ── Compute current multiplier from elapsed time ────────────────────
      const now = new Date();
      const startedAt = new Date(round.startedAt);
      const elapsedMs = now.getTime() - startedAt.getTime();
      const currentMultiplier = getMultiplierAtTime(elapsedMs);
      const flyAwayPoint = Number(round.flyAwayPoint);

      // ── Check if already crashed ────────────────────────────────────────
      if (currentMultiplier >= flyAwayPoint) {
        // The plane already crashed — too late to cash out
        // Mark as crashed and return loss
        await tx.aviatorRound.update({
          where: { id: roundId },
          data: {
            status: "CRASHED",
            settledAt: now,
            grossPayoutGzo: "0",
            profitGzo: String(-Number(round.stakeGzo)),
            feeGzo: "0",
            netPayoutGzo: "0",
          },
        });

        const stake = Number(round.stakeGzo);

        // Create GameBet for history
        await tx.gameBet.create({
          data: {
            userId,
            gameType: "AVIATOR",
            stakeGzo: round.stakeGzo,
            status: "SETTLED",
            idempotencyKey: `aviator-settle:${roundId}`,
            serverSeedHash: round.serverSeedHash,
            serverSeedRevealed: round.serverSeed,
            clientSeed: round.clientSeed,
            nonce: round.nonce,
            publicSeed: round.publicSeed,
            referenceId: roundId,
            settledAt: now,
            resultJson: {
              outcome: "CRASHED",
              flyAwayPoint,
              cashoutMultiplier: null,
              rngVersion: AVIATOR_VERSION,
            },
            grossPayoutGzo: "0",
            profitGzo: String(-stake),
            feeGzo: "0",
            netPayoutGzo: "0",
          },
        });

        return {
          outcome: "CRASHED" as const,
          flyAwayPoint,
          cashoutMultiplier: currentMultiplier,
          elapsedMs,
          grossPayoutGzo: 0,
          profitGzo: -stake,
          feeGzo: 0,
          netPayoutGzo: 0,
          serverSeed: round.serverSeed,
          serverSeedHash: round.serverSeedHash,
          clientSeed: round.clientSeed,
          nonce: round.nonce,
          publicSeed: round.publicSeed,
        };
      }

      // ── Cash out successfully ───────────────────────────────────────────
      const stake = Number(round.stakeGzo);
      const grossPayout = computeAviatorGrossPayout(stake, currentMultiplier);
      const { profitGzo, feeGzo, netPayoutGzo } = settle(stake, grossPayout);

      // ── Pay player ──────────────────────────────────────────────────────
      const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
      const balanceBefore = Number(wallet.balance);
      const balanceAfter = balanceBefore + netPayoutGzo;

      await tx.walletBalance.update({
        where: { userId },
        data: { balance: String(balanceAfter) },
      });
      await tx.ledgerEntry.create({
        data: {
          userId,
          type: LedgerEntryType.BET_WON,
          amount: String(netPayoutGzo),
          balanceBefore: String(balanceBefore),
          balanceAfter: String(balanceAfter),
          reference: roundId,
        },
      });

      // ── House pays gross, re-credits fee ────────────────────────────────
      await debitHouseTx(tx, grossPayout, HouseLedgerType.BET_OUT, roundId);
      if (feeGzo > 0) await creditHouseTx(tx, feeGzo, HouseLedgerType.FEE, roundId);

      // ── Settle AviatorRound ─────────────────────────────────────────────
      await tx.aviatorRound.update({
        where: { id: roundId },
        data: {
          status: "CASHED_OUT",
          cashoutMultiplier: currentMultiplier,
          settledAt: now,
          grossPayoutGzo: String(grossPayout),
          profitGzo: String(profitGzo),
          feeGzo: String(feeGzo),
          netPayoutGzo: String(netPayoutGzo),
        },
      });

      // ── Create GameBet for history ──────────────────────────────────────
      await tx.gameBet.create({
        data: {
          userId,
          gameType: "AVIATOR",
          stakeGzo: round.stakeGzo,
          status: "SETTLED",
          idempotencyKey: `aviator-settle:${roundId}`,
          serverSeedHash: round.serverSeedHash,
          serverSeedRevealed: round.serverSeed,
          clientSeed: round.clientSeed,
          nonce: round.nonce,
          publicSeed: round.publicSeed,
          referenceId: roundId,
          settledAt: now,
          resultJson: {
            outcome: "CASHED_OUT",
            flyAwayPoint,
            cashoutMultiplier: currentMultiplier,
            elapsedMs,
            rngVersion: AVIATOR_VERSION,
          },
          grossPayoutGzo: String(grossPayout),
          profitGzo: String(profitGzo),
          feeGzo: String(feeGzo),
          netPayoutGzo: String(netPayoutGzo),
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: "aviator.cashout",
          entity: "AviatorRound",
          entityId: roundId,
          metadata: {
            stake,
            cashoutMultiplier: currentMultiplier,
            flyAwayPoint,
            elapsedMs,
            grossPayout,
            profitGzo,
            feeGzo,
            netPayoutGzo,
          },
        },
      });

      return {
        outcome: "CASHED_OUT" as const,
        flyAwayPoint,
        cashoutMultiplier: currentMultiplier,
        elapsedMs,
        grossPayoutGzo: grossPayout,
        profitGzo,
        feeGzo,
        netPayoutGzo,
        balanceBefore,
        balanceAfter,
        serverSeed: round.serverSeed,
        serverSeedHash: round.serverSeedHash,
        clientSeed: round.clientSeed,
        nonce: round.nonce,
        publicSeed: round.publicSeed,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    const clientErrors = ["Not your round", "Round is not in flight"];
    if (clientErrors.includes(msg)) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("aviator/cashout error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
