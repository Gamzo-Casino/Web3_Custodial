import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { buildHiloState } from "@/lib/hilo";
import { LedgerEntryType } from "@/lib/ledger";

export const dynamic = "force-dynamic";

const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authUser.userId;

  try {
    // ── Active HiloRound ──────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const round = await (prisma as any).hiloRound.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });

    if (round) {
      return NextResponse.json({ round: buildHiloState(round) });
    }

    // ── PENDING GameBet (VRF in flight) ───────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pendingBet = await (prisma as any).gameBet.findFirst({
      where: { userId, gameType: "HILO", status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });

    if (!pendingBet) {
      return NextResponse.json({ round: null });
    }

    const ageMs = Date.now() - new Date(pendingBet.createdAt).getTime();

    // Stale — auto-refund silently so the page loads clean
    if (ageMs >= PENDING_TTL_MS) {
      const stakeGzo = Number(pendingBet.stakeGzo);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (prisma as any).$transaction(async (tx: any) => {
          const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
          const balBefore = Number(wallet.balance);
          const balAfter  = balBefore + stakeGzo;
          await tx.walletBalance.update({ where: { userId }, data: { balance: String(balAfter) } });
          await tx.ledgerEntry.create({
            data: {
              userId,
              type:          LedgerEntryType.BET_REFUND,
              amount:        String(stakeGzo),
              balanceBefore: String(balBefore),
              balanceAfter:  String(balAfter),
              reference:     `vrf-refund:${pendingBet.id}`,
            },
          });
          await tx.gameBet.update({
            where: { id: pendingBet.id },
            data: {
              status:    "REFUNDED",
              settledAt: new Date(),
              resultJson: {
                ...(pendingBet.resultJson ?? {}),
                refundReason: "vrf_timeout_auto",
                refundedAt: new Date().toISOString(),
              },
            },
          });
        });
      } catch (refundErr) {
        console.error("hilo/current auto-refund error:", refundErr);
      }
      // Return clean state regardless of whether refund succeeded
      return NextResponse.json({ round: null });
    }

    // Still within TTL — return as pending so frontend can poll VRF
    if (pendingBet.onchainRoundId) {
      return NextResponse.json({
        round:   null,
        pending: { roundId: pendingBet.onchainRoundId },
      });
    }

    return NextResponse.json({ round: null });
  } catch (err) {
    console.error("hilo/current error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
