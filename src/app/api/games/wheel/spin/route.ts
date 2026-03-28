import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { settle } from "@/lib/settlement";
import { creditHouseTx, debitHouseTx, HouseLedgerType } from "@/lib/house";
import { getBetSeedsTx, rotateSeedTx, incrementNonceTx } from "@/lib/seedManager";
import {
  computeWheelPublicSeed,
  computeWheelSpin,
  computeWheelGrossPayout,
  WHEEL_CONFIGS,
  WHEEL_VERSION,
  type WheelRisk,
} from "@/lib/wheel";
import { z } from "zod";

const bodySchema = z.object({
  stakeGzo: z.number().int().min(1).max(100_000),
  risk: z.enum(["low", "medium", "high"]),
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

  const { stakeGzo: stake, risk } = body;
  const config = WHEEL_CONFIGS[risk as WheelRisk];

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (prisma as any).$transaction(async (tx: any) => {
      // ── 1. Seeds ───────────────────────────────────────────────────────────
      const seeds = await getBetSeedsTx(tx, userId);
      const { serverSeed, serverSeedHash, clientSeed, nonce } = seeds;

      // ── 2. Compute spin result ─────────────────────────────────────────────
      const publicSeed = computeWheelPublicSeed(userId);
      const spinResult = computeWheelSpin(serverSeed, clientSeed, publicSeed, nonce, risk as WheelRisk);
      const { stopPosition, segmentIndex, segmentLabel, landedMultiplier } = spinResult;

      // ── 3. Settlement math ─────────────────────────────────────────────────
      const grossPayoutGzo = computeWheelGrossPayout(stake, landedMultiplier);
      const { profitGzo, feeGzo, netPayoutGzo } = settle(stake, grossPayoutGzo);
      const won = grossPayoutGzo > 0;

      // ── 4. House solvency check ────────────────────────────────────────────
      if (won) {
        const house = await tx.houseTreasury.findUniqueOrThrow({ where: { id: "house" } });
        if (Number(house.balanceGzo) < grossPayoutGzo) throw new Error("House treasury too low");
      }

      // ── 5. Debit player stake ──────────────────────────────────────────────
      const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
      const balanceBefore = Number(wallet.balance);
      if (balanceBefore < stake) throw new Error("Insufficient balance");
      const balanceAfterStake = balanceBefore - stake;

      await tx.walletBalance.update({ where: { userId }, data: { balance: String(balanceAfterStake) } });
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

      // ── 6. House receives stake ────────────────────────────────────────────
      await creditHouseTx(tx, stake, HouseLedgerType.BET_IN);

      // ── 7. If won: pay player ──────────────────────────────────────────────
      let finalBalance = balanceAfterStake;
      if (won) {
        await debitHouseTx(tx, grossPayoutGzo, HouseLedgerType.BET_OUT);
        if (feeGzo > 0) await creditHouseTx(tx, feeGzo, HouseLedgerType.FEE);

        finalBalance = balanceAfterStake + netPayoutGzo;
        await tx.walletBalance.update({ where: { userId }, data: { balance: String(finalBalance) } });
        await tx.ledgerEntry.create({
          data: {
            userId,
            type: LedgerEntryType.BET_WON,
            amount: String(netPayoutGzo),
            balanceBefore: String(balanceAfterStake),
            balanceAfter: String(finalBalance),
            reference: null,
          },
        });
      }

      // ── 8. Rotate seed (after result — commit/reveal guarantee) ───────────
      const { revealedSeed } = await rotateSeedTx(tx, userId);
      await incrementNonceTx(tx, userId);

      const idempotencyKey = `wheel:${userId}:${nonce}`;
      const now = new Date();

      // ── 9. Create WheelRound ───────────────────────────────────────────────
      const round = await tx.wheelRound.create({
        data: {
          userId,
          stakeGzo:         String(stake),
          riskMode:         risk,
          configVersion:    config.version,
          stopPosition,
          segmentIndex,
          segmentLabel,
          landedMultiplier: String(landedMultiplier),
          grossPayoutGzo:   String(grossPayoutGzo),
          profitGzo:        String(profitGzo),
          feeGzo:           String(feeGzo),
          netPayoutGzo:     String(netPayoutGzo),
          serverSeed:       revealedSeed,
          serverSeedHash,
          clientSeed,
          nonce,
          publicSeed,
          rngVersion:       WHEEL_VERSION,
          idempotencyKey,
        },
      });

      // ── 10. Create GameBet for global history ─────────────────────────────
      await tx.gameBet.create({
        data: {
          userId,
          gameType:          "WHEEL",
          stakeGzo:          String(stake),
          status:            "SETTLED",
          idempotencyKey:    `wheel-bet:${userId}:${nonce}`,
          serverSeedHash,
          serverSeedRevealed: revealedSeed,
          clientSeed,
          nonce,
          publicSeed,
          referenceId:       round.id,
          settledAt:         now,
          resultJson: {
            risk,
            configVersion: config.version,
            stopPosition,
            segmentIndex,
            segmentLabel,
            landedMultiplier,
            won,
            rngVersion: WHEEL_VERSION,
          },
          grossPayoutGzo:   String(grossPayoutGzo),
          profitGzo:        String(profitGzo),
          feeGzo:           String(feeGzo),
          netPayoutGzo:     String(netPayoutGzo),
        },
      });

      // ── 11. Audit log ──────────────────────────────────────────────────────
      await tx.auditLog.create({
        data: {
          userId,
          action: "wheel.spin",
          entity: "WheelRound",
          entityId: round.id,
          metadata: { stake, risk, stopPosition, segmentLabel, landedMultiplier, grossPayoutGzo, profitGzo, feeGzo, netPayoutGzo, nonce },
        },
      });

      return {
        roundId:          round.id,
        risk,
        stopPosition,
        segmentIndex,
        segmentLabel,
        landedMultiplier,
        won,
        grossPayoutGzo,
        profitGzo,
        feeGzo,
        netPayoutGzo,
        balanceBefore,
        balanceAfter:    finalBalance,
        serverSeed:      revealedSeed,
        serverSeedHash,
        clientSeed,
        nonce,
        publicSeed,
        rngVersion:      WHEEL_VERSION,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    if (msg === "Insufficient balance" || msg.startsWith("House treasury")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("wheel/spin error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
