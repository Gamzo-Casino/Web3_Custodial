/**
 * GET /api/games/wheel/status?roundId=0x...
 *
 * Polls the on-chain WheelGame for VRF settlement.
 * Once settled, credits the win to DB balance (idempotent).
 *
 * Response while pending: { settled: false, reason: "vrf_pending" | "round_not_found" }
 * Response once settled:  { settled: true, won, riskMode, stopPosition, segmentIndex,
 *                           multiplier100, netPayoutGzo, grossPayoutGzo, feeGzo,
 *                           balanceAfter, stakeGzo, roundId, betId }
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { debitHouseTx, creditHouseTx, HouseLedgerType } from "@/lib/house";
import { getPublicClient, WHEEL_GAME_ABI } from "@/lib/viemServer";
import { formatEther } from "viem";

const WHEEL_GAME_ADDRESS = "0x98c304b90f14c69275014eb22Eb60694d07184a2" as const;
const RISK_NAMES = ["low", "medium", "high"] as const;

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = authUser;
  const roundId = req.nextUrl.searchParams.get("roundId");
  if (!roundId || !/^0x[0-9a-fA-F]{64}$/.test(roundId)) {
    return NextResponse.json({ error: "Invalid roundId" }, { status: 400 });
  }

  // ── 1. Idempotency check ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingBet = await (prisma as any).gameBet.findFirst({
    where: { onchainRoundId: roundId, userId },
  });

  if (existingBet?.status === "SETTLED") {
    const r = existingBet.resultJson as Record<string, unknown>;
    return NextResponse.json({
      settled:        true,
      won:            r.won            as boolean,
      riskMode:       r.riskMode       as string,
      stopPosition:   r.stopPosition   as number,
      segmentIndex:   r.segmentIndex   as number,
      multiplier100:  r.multiplier100  as number,
      netPayoutGzo:   r.netPayoutGzo   as number,
      grossPayoutGzo: r.grossPayoutGzo as number,
      feeGzo:         r.feeGzo         as number,
      balanceAfter:   r.balanceAfter   as number,
      stakeGzo:       r.stakeGzo       as number,
      roundId,
      betId: existingBet.id,
    });
  }

  // ── 2. Read on-chain round ─────────────────────────────────────────────────
  let round: {
    player:        string;
    stake:         bigint;
    riskMode:      number;
    stopPosition:  bigint;
    segmentIndex:  number;
    multiplier100: bigint;
    netPayout:     bigint;
    settled:       boolean;
    createdAt:     bigint;
    custodial:     boolean;
  };

  try {
    const publicClient = getPublicClient();
    const result = await publicClient.readContract({
      address:      WHEEL_GAME_ADDRESS,
      abi:          WHEEL_GAME_ABI,
      functionName: "getRound",
      args:         [roundId as `0x${string}`],
    });
    round = result as typeof round;
  } catch (err) {
    console.error("wheel/status: getRound error:", err);
    return NextResponse.json({ error: "Failed to read on-chain round" }, { status: 500 });
  }

  if (round.player === "0x0000000000000000000000000000000000000000") {
    return NextResponse.json({ settled: false, reason: "round_not_found" });
  }

  if (!round.settled) {
    return NextResponse.json({ settled: false, reason: "vrf_pending" });
  }

  // ── 3. Compute payouts ────────────────────────────────────────────────────
  const stakeGzo      = Number(formatEther(round.stake));
  const multiplier100 = Number(round.multiplier100);
  const won           = multiplier100 > 0;
  const netPayoutGzo  = Number(formatEther(round.netPayout));
  const grossPayoutGzo = won ? Math.round(stakeGzo * multiplier100 / 100) : 0;
  const feeGzo        = won ? Math.max(0, grossPayoutGzo - netPayoutGzo) : 0;
  const stopPosition  = Number(round.stopPosition);
  const segmentIndex  = Number(round.segmentIndex);
  const riskMode      = RISK_NAMES[round.riskMode] ?? "low";

  // ── 4. Credit win & mark SETTLED (idempotent) ────────────────────────────
  if (!existingBet) {
    return NextResponse.json({ error: "Bet record not found in DB" }, { status: 404 });
  }

  let balanceAfter: number;

  if (existingBet.status === "PENDING") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const settled = await (prisma as any).$transaction(async (tx: any) => {
        const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
        const balBefore = Number(wallet.balance);
        const newBalance = won ? balBefore + netPayoutGzo : balBefore;

        if (won) {
          await tx.walletBalance.update({
            where: { userId },
            data:  { balance: String(newBalance) },
          });
          await tx.ledgerEntry.create({
            data: {
              userId,
              type:          LedgerEntryType.BET_WON,
              amount:        String(netPayoutGzo),
              balanceBefore: String(balBefore),
              balanceAfter:  String(newBalance),
              reference:     `wheel-win:${roundId}`,
            },
          });
          await debitHouseTx(tx, grossPayoutGzo, HouseLedgerType.BET_OUT, roundId);
          if (feeGzo > 0) await creditHouseTx(tx, feeGzo, HouseLedgerType.FEE, roundId);
        }

        const resultJson = {
          won, riskMode, stopPosition, segmentIndex, multiplier100,
          netPayoutGzo, grossPayoutGzo, feeGzo,
          balanceAfter: newBalance, stakeGzo,
          roundId, onChain: true,
        };

        await tx.gameBet.update({
          where: { id: existingBet.id },
          data: {
            status:         "SETTLED",
            settledAt:      new Date(),
            netPayoutGzo:   String(netPayoutGzo),
            grossPayoutGzo: String(grossPayoutGzo),
            profitGzo:      String(netPayoutGzo - stakeGzo),
            feeGzo:         String(feeGzo),
            resultJson,
          },
        });

        return newBalance;
      });

      balanceAfter = settled;
    } catch (err) {
      console.error("wheel/status: DB settlement error:", err);
      return NextResponse.json({ error: "Settlement DB error" }, { status: 500 });
    }
  } else {
    balanceAfter = 0;
  }

  return NextResponse.json({
    settled: true,
    won, riskMode, stopPosition, segmentIndex, multiplier100,
    netPayoutGzo, grossPayoutGzo, feeGzo,
    balanceAfter, stakeGzo,
    roundId, betId: existingBet.id,
  });
}
