/**
 * GET /api/games/keno/status?roundId=0x...
 *
 * Polls the on-chain KenoGame for VRF settlement.
 * Once settled, credits the win to DB balance (idempotent).
 *
 * Response while pending: { settled: false, reason: "vrf_pending" | "round_not_found" }
 * Response once settled:  { settled: true, won, drawn, matchCount, multiplier,
 *                           netPayoutGzo, grossPayoutGzo, feeGzo, balanceAfter,
 *                           stakeGzo, picks, roundId, betId }
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { getPublicClient, KENO_GAME_ABI } from "@/lib/viemServer";
import { formatEther } from "viem";

const KENO_GAME_ADDRESS = "0x44dC17d94345B4970caCecF7954AB676A25c6125" as const;

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
      won:           r.won           as boolean,
      drawn:         r.drawn         as number[],
      matchCount:    r.matchCount    as number,
      multiplier:    r.multiplier    as number,
      netPayoutGzo:  r.netPayoutGzo  as number,
      grossPayoutGzo: r.grossPayoutGzo as number,
      feeGzo:        r.feeGzo        as number,
      balanceAfter:  r.balanceAfter  as number,
      stakeGzo:      r.stakeGzo      as number,
      picks:         r.picks         as number[],
      roundId,
      betId: existingBet.id,
    });
  }

  // ── 2. Read on-chain round ─────────────────────────────────────────────────
  let round: {
    player:        string;
    stake:         bigint;
    picks:         readonly number[];
    drawn:         readonly number[];
    matchCount:    bigint;
    multiplier100: bigint;
    netPayout:     bigint;
    settled:       boolean;
    createdAt:     bigint;
    custodial:     boolean;
  };

  try {
    const publicClient = getPublicClient();
    const result = await publicClient.readContract({
      address:      KENO_GAME_ADDRESS,
      abi:          KENO_GAME_ABI,
      functionName: "getRound",
      args:         [roundId as `0x${string}`],
    });
    round = result as typeof round;
  } catch (err) {
    console.error("keno/status: getRound error:", err);
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
  const drawn         = Array.from(round.drawn).map(Number);
  const picks         = Array.from(round.picks).map(Number);
  const matchCount    = Number(round.matchCount);
  const multiplier    = Number(round.multiplier100) / 100;
  const won           = round.multiplier100 > 0n;
  const netPayoutGzo  = Number(formatEther(round.netPayout));
  const grossPayoutGzo = won
    ? Number(formatEther((round.stake * round.multiplier100) / 100n))
    : 0;
  const feeGzo = won ? grossPayoutGzo - netPayoutGzo : 0;

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
              reference:     `keno-win:${roundId}`,
            },
          });
        }

        const resultJson = {
          won, drawn, picks, matchCount, multiplier,
          netPayoutGzo, grossPayoutGzo, feeGzo,
          balanceAfter: newBalance, stakeGzo,
          roundId, onChain: true,
        };

        await tx.gameBet.update({
          where: { id: existingBet.id },
          data:  {
            status:         "SETTLED",
            settledAt:      new Date(),
            netPayoutGzo:   String(netPayoutGzo),
            grossPayoutGzo: String(grossPayoutGzo),
            feeGzo:         String(feeGzo),
            resultJson,
          },
        });

        return newBalance;
      });

      balanceAfter = settled;
    } catch (err) {
      console.error("keno/status: DB settlement error:", err);
      return NextResponse.json({ error: "Settlement DB error" }, { status: 500 });
    }
  } else {
    balanceAfter = 0;
  }

  return NextResponse.json({
    settled: true,
    won, drawn, picks, matchCount, multiplier,
    netPayoutGzo, grossPayoutGzo, feeGzo,
    balanceAfter, stakeGzo,
    roundId, betId: existingBet.id,
  });
}
