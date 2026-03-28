/**
 * GET /api/games/dice/status?roundId=0x...
 *
 * Polls the on-chain DiceGame for VRF settlement.
 * Once settled, credits the win to DB balance (idempotent — only credited once).
 *
 * Response while pending: { settled: false }
 * Response once settled:  { settled: true, won, roll, netPayoutGzo, feeGzo, grossPayoutGzo,
 *                           balanceAfter, roundId, betId }
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { getPublicClient, DICE_GAME_ABI } from "@/lib/viemServer";
import { formatEther } from "viem";

const DICE_GAME_ADDRESS = "0x4b87dF81A498ed204590f9aF25b8889cd0cBC5f7" as const;

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
    // Already processed — return cached result
    const r = existingBet.resultJson as Record<string, unknown>;
    return NextResponse.json({
      settled:      true,
      won:          r.won as boolean,
      roll:         r.roll as number,
      target:       r.target as number,
      netPayoutGzo: r.netPayoutGzo as number,
      grossPayoutGzo: r.grossPayoutGzo as number,
      feeGzo:       r.feeGzo as number,
      balanceAfter: r.balanceAfter as number,
      roundId,
      betId:        existingBet.id,
    });
  }

  // ── 2. Read on-chain round ────────────────────────────────────────────────
  let round: {
    player: string;
    stake: bigint;
    targetScaled: bigint;
    roll: bigint;
    netPayout: bigint;
    won: boolean;
    settled: boolean;
    createdAt: bigint;
    custodial: boolean;
  };

  try {
    const publicClient = getPublicClient();
    const result = await publicClient.readContract({
      address:      DICE_GAME_ADDRESS,
      abi:          DICE_GAME_ABI,
      functionName: "getRound",
      args:         [roundId as `0x${string}`],
    });
    round = result as typeof round;
  } catch (err) {
    console.error("dice/status: getRound error:", err);
    return NextResponse.json({ error: "Failed to read on-chain round" }, { status: 500 });
  }

  // Round not yet committed on-chain (e.g., tx not mined yet)
  if (round.player === "0x0000000000000000000000000000000000000000") {
    return NextResponse.json({ settled: false, reason: "round_not_found" });
  }

  if (!round.settled) {
    return NextResponse.json({ settled: false, reason: "vrf_pending" });
  }

  // ── 3. VRF fulfilled — compute payouts & credit DB ─────────────────────────
  const stakeGzo    = Number(formatEther(round.stake));
  const roll        = Number(round.roll) / 100;         // [0,9999] → [0,99.99]
  const target      = Number(round.targetScaled) / 100; // [101,9800] → [1.01,98.00]
  const netPayoutGzo   = Number(formatEther(round.netPayout));
  // grossPayout = stake × 9900 / targetScaled  (same formula as GameMath.diceGross)
  const grossPayoutGzo = round.won
    ? Number(formatEther((round.stake * 9900n) / round.targetScaled))
    : 0;
  const feeGzo = round.won ? grossPayoutGzo - netPayoutGzo : 0;

  // ── 4. Credit win to DB (idempotent via status=PENDING guard) ─────────────
  let balanceAfter: number;

  if (!existingBet) {
    // Bet record not found (edge case — bet may have been placed before this schema)
    return NextResponse.json({ error: "Bet record not found in DB" }, { status: 404 });
  }

  if (existingBet.status === "PENDING") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const settled = await (prisma as any).$transaction(async (tx: any) => {
        const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
        const balBefore = Number(wallet.balance);
        const newBalance = round.won ? balBefore + netPayoutGzo : balBefore;

        if (round.won) {
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
              reference:     `dice-win:${roundId}`,
            },
          });
        }

        const resultJson = {
          roll,
          target,
          won:           round.won,
          netPayoutGzo,
          grossPayoutGzo,
          feeGzo,
          balanceAfter:  newBalance,
          stakeGzo,
          roundId,
          onChain:       true,
        };

        await tx.gameBet.update({
          where: { id: existingBet.id },
          data:  {
            status:        "SETTLED",
            settledAt:     new Date(),
            netPayoutGzo:  String(netPayoutGzo),
            grossPayoutGzo: String(grossPayoutGzo),
            feeGzo:        String(feeGzo),
            resultJson,
          },
        });

        return newBalance;
      });

      balanceAfter = settled;
    } catch (err) {
      console.error("dice/status: DB settlement error:", err);
      return NextResponse.json({ error: "Settlement DB error" }, { status: 500 });
    }
  } else {
    // REFUNDED or other terminal state — shouldn't normally be polled
    balanceAfter = 0;
  }

  return NextResponse.json({
    settled:       true,
    won:           round.won,
    roll,
    target,
    netPayoutGzo,
    grossPayoutGzo,
    feeGzo,
    balanceAfter,
    stakeGzo,
    roundId,
    betId: existingBet.id,
  });
}
