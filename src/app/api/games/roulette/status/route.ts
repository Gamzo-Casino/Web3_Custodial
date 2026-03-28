/**
 * GET /api/games/roulette/status?roundId=0x...
 *
 * Polls the on-chain RouletteGame for VRF settlement.
 * Once settled, credits the win to DB balance (idempotent).
 *
 * Response while pending: { settled: false, reason: "vrf_pending" | "round_not_found" }
 * Response once settled:  { settled: true, winningNumber, won, netPayoutGzo,
 *                           totalGrossGzo, feeGzo, totalStakeGzo,
 *                           breakdown, balanceAfter, roundId, betId }
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { getPublicClient, ROULETTE_GAME_ABI } from "@/lib/viemServer";
import { formatEther } from "viem";
import { doesBetWin, getGrossMultiplier, getColor, Wager } from "@/lib/roulette";

const ROULETTE_GAME_ADDRESS = "0x13CeBf51251547A048DF83A5561a0361822e298b" as const;

export const dynamic = "force-dynamic";

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
      settled:       true,
      winningNumber: r.winningNumber  as number,
      winningColor:  r.winningColor   as string,
      won:           r.won            as boolean,
      netPayoutGzo:  r.netPayoutGzo   as number,
      totalGrossGzo: r.totalGrossGzo  as number,
      feeGzo:        r.feeGzo         as number,
      totalStakeGzo: r.totalStakeGzo  as number,
      breakdown:     r.breakdown      as unknown[],
      balanceAfter:  r.balanceAfter   as number,
      roundId,
      betId: existingBet.id,
    });
  }

  // ── 2. Read on-chain round ─────────────────────────────────────────────────
  let round: {
    player:        string;
    totalStake:    bigint;
    winningNumber: bigint;
    totalGross:    bigint;
    netPayout:     bigint;
    settled:       boolean;
    createdAt:     bigint;
    custodial:     boolean;
  };

  try {
    const publicClient = getPublicClient();
    const result = await publicClient.readContract({
      address:      ROULETTE_GAME_ADDRESS,
      abi:          ROULETTE_GAME_ABI,
      functionName: "getRound",
      args:         [roundId as `0x${string}`],
    });
    round = result as typeof round;
  } catch (err) {
    console.error("roulette/status: getRound error:", err);
    return NextResponse.json({ error: "Failed to read on-chain round" }, { status: 500 });
  }

  if (round.player === "0x0000000000000000000000000000000000000000") {
    return NextResponse.json({ settled: false, reason: "round_not_found" });
  }

  if (!round.settled) {
    return NextResponse.json({ settled: false, reason: "vrf_pending" });
  }

  // ── 3. Compute payouts from on-chain data ─────────────────────────────────
  const totalStakeGzo  = Number(formatEther(round.totalStake));
  const totalGrossGzo  = Number(formatEther(round.totalGross));
  const netPayoutGzo   = Number(formatEther(round.netPayout));
  const winningNumber  = Number(round.winningNumber);
  const winningColor   = getColor(winningNumber);
  const won            = round.netPayout > 0n;
  const feeGzo         = won ? totalGrossGzo - netPayoutGzo : 0;

  // Per-wager breakdown from stored wagers
  const storedWagers: Wager[] = existingBet?.resultJson?.wagers ?? [];
  const breakdown = storedWagers.map((w: Wager) => {
    const didWin    = doesBetWin(w.area, winningNumber);
    const mult      = getGrossMultiplier(w.area);
    const grossPayout = didWin ? Math.floor(w.stake * mult) : 0;
    return { area: w.area, stake: w.stake, won: didWin, grossPayout };
  });

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
              reference:     `roulette-win:${roundId}`,
            },
          });
        }

        const resultJson = {
          winningNumber, winningColor, won, breakdown,
          netPayoutGzo, totalGrossGzo, feeGzo,
          totalStakeGzo,
          balanceAfter: newBalance,
          roundId, onChain: true,
        };

        await tx.gameBet.update({
          where: { id: existingBet.id },
          data:  {
            status:         "SETTLED",
            settledAt:      new Date(),
            netPayoutGzo:   String(netPayoutGzo),
            grossPayoutGzo: String(totalGrossGzo),
            feeGzo:         String(feeGzo),
            profitGzo:      String(netPayoutGzo - totalStakeGzo),
            resultJson,
          },
        });

        return newBalance;
      });

      balanceAfter = settled;
    } catch (err) {
      console.error("roulette/status: DB settlement error:", err);
      return NextResponse.json({ error: "Settlement DB error" }, { status: 500 });
    }
  } else {
    balanceAfter = 0;
  }

  return NextResponse.json({
    settled: true,
    winningNumber, winningColor, won,
    netPayoutGzo, totalGrossGzo, feeGzo, totalStakeGzo,
    breakdown, balanceAfter,
    roundId, betId: existingBet.id,
  });
}
