/**
 * GET /api/games/plinko/status?roundId=0x...
 *
 * Polls the on-chain PlinkoGame for VRF settlement.
 * Once settled, credits the win to DB balance (idempotent — only credited once).
 *
 * Response while pending: { settled: false, reason: "vrf_pending" | "round_not_found" }
 * Response once settled:  { settled: true, won, pathBits, binIndex, multiplier, rows, risk,
 *                           netPayoutGzo, grossPayoutGzo, feeGzo, balanceAfter, roundId, betId }
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { debitHouseTx, creditHouseTx, HouseLedgerType } from "@/lib/house";
import { getPublicClient, PLINKO_GAME_ABI } from "@/lib/viemServer";
import { formatEther } from "viem";

const PLINKO_GAME_ADDRESS = "0x8e10fE2d7E642d21eAd14ff52F2ADD38e00c23de" as const;

const RISK_LABELS: Record<number, string> = { 0: "low", 1: "med", 2: "high" };

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

  // ── 1. Check if already settled in DB (idempotency) ───────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingBet = await (prisma as any).gameBet.findFirst({
    where: { onchainRoundId: roundId, userId },
  });

  if (existingBet?.status === "SETTLED") {
    const r = existingBet.resultJson as Record<string, unknown>;
    return NextResponse.json({
      settled:       true,
      won:           r.won           as boolean,
      pathBits:      r.pathBits      as number,
      binIndex:      r.binIndex      as number,
      multiplier:    r.multiplier    as number,
      rows:          r.rows          as number,
      risk:          r.risk          as string,
      netPayoutGzo:  r.netPayoutGzo  as number,
      grossPayoutGzo: r.grossPayoutGzo as number,
      feeGzo:        r.feeGzo        as number,
      balanceAfter:  r.balanceAfter  as number,
      roundId,
      betId: existingBet.id,
    });
  }

  // ── 2. Read on-chain round ─────────────────────────────────────────────────
  let round: {
    player:        string;
    stake:         bigint;
    rows:          number;
    risk:          number;
    pathBits:      bigint;
    binIndex:      bigint;
    multiplier100: bigint;
    netPayout:     bigint;
    settled:       boolean;
    createdAt:     bigint;
    custodial:     boolean;
  };

  try {
    const publicClient = getPublicClient();
    const result = await publicClient.readContract({
      address:      PLINKO_GAME_ADDRESS,
      abi:          PLINKO_GAME_ABI,
      functionName: "getRound",
      args:         [roundId as `0x${string}`],
    });
    round = result as typeof round;
  } catch (err) {
    console.error("plinko/status: getRound error:", err);
    return NextResponse.json({ error: "Failed to read on-chain round" }, { status: 500 });
  }

  if (round.player === "0x0000000000000000000000000000000000000000") {
    return NextResponse.json({ settled: false, reason: "round_not_found" });
  }

  if (!round.settled) {
    return NextResponse.json({ settled: false, reason: "vrf_pending" });
  }

  // ── 3. VRF fulfilled — compute payouts & credit DB ─────────────────────────
  const stakeGzo      = Number(formatEther(round.stake));
  const pathBits      = Number(round.pathBits);
  const binIndex      = Number(round.binIndex);
  const multiplier    = Number(round.multiplier100) / 100;
  const rows          = Number(round.rows);
  const risk          = RISK_LABELS[Number(round.risk)] ?? "low";
  const netPayoutGzo  = Number(formatEther(round.netPayout));
  const won           = round.multiplier100 > 0n;
  const grossPayoutGzo = won
    ? Number(formatEther((round.stake * round.multiplier100) / 100n))
    : 0;
  const feeGzo = won ? grossPayoutGzo - netPayoutGzo : 0;

  // ── 4. Credit win to DB (idempotent via status=PENDING guard) ─────────────
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
              reference:     `plinko-win:${roundId}`,
            },
          });
          await debitHouseTx(tx, grossPayoutGzo, HouseLedgerType.BET_OUT, roundId);
          if (feeGzo > 0) await creditHouseTx(tx, feeGzo, HouseLedgerType.FEE, roundId);
        }

        const resultJson = {
          won,
          pathBits,
          binIndex,
          multiplier,
          rows,
          risk,
          netPayoutGzo,
          grossPayoutGzo,
          feeGzo,
          balanceAfter: newBalance,
          stakeGzo,
          roundId,
          onChain: true,
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
      console.error("plinko/status: DB settlement error:", err);
      return NextResponse.json({ error: "Settlement DB error" }, { status: 500 });
    }
  } else {
    balanceAfter = 0;
  }

  return NextResponse.json({
    settled:       true,
    won,
    pathBits,
    binIndex,
    multiplier,
    rows,
    risk,
    netPayoutGzo,
    grossPayoutGzo,
    feeGzo,
    balanceAfter,
    stakeGzo,
    roundId,
    betId: existingBet.id,
  });
}
