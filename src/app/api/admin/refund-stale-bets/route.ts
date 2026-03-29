/**
 * Admin route — refund stale PENDING GameBets stuck waiting for VRF.
 *
 * GET  /api/admin/refund-stale-bets?olderThanMinutes=30
 *   → lists all PENDING bets older than threshold (dry-run, no changes)
 *
 * POST /api/admin/refund-stale-bets
 *   body: { olderThanMinutes?: number (default 30), dryRun?: boolean (default false) }
 *   → refunds each stale bet: credits stake back, creates BET_REFUND ledger entry,
 *     marks GameBet as REFUNDED
 *
 * Auth: Bearer AUTH_SECRET header (same as treasury route)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const secret = process.env.AUTH_SECRET ?? "";
  return token === secret && token.length >= 16;
}

async function getStaleBets(olderThanMinutes: number) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma as any).gameBet.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const olderThanMinutes = Number(req.nextUrl.searchParams.get("olderThanMinutes") ?? "30");
  if (isNaN(olderThanMinutes) || olderThanMinutes < 1) {
    return NextResponse.json({ error: "Invalid olderThanMinutes" }, { status: 400 });
  }

  try {
    const bets = await getStaleBets(olderThanMinutes);
    return NextResponse.json({
      count: bets.length,
      olderThanMinutes,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bets: bets.map((b: any) => ({
        id: b.id,
        userId: b.userId,
        gameType: b.gameType,
        stakeGzo: Number(b.stakeGzo),
        createdAt: b.createdAt,
        onchainRoundId: b.onchainRoundId,
        txHash: b.txHash,
        minutesAgo: Math.round((Date.now() - new Date(b.createdAt).getTime()) / 60000),
      })),
    });
  } catch (err) {
    console.error("admin/refund-stale-bets GET error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { olderThanMinutes?: number; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const olderThanMinutes = body.olderThanMinutes ?? 30;
  const dryRun = body.dryRun ?? false;

  if (typeof olderThanMinutes !== "number" || olderThanMinutes < 1) {
    return NextResponse.json({ error: "Invalid olderThanMinutes" }, { status: 400 });
  }

  try {
    const bets = await getStaleBets(olderThanMinutes);

    if (bets.length === 0) {
      return NextResponse.json({ ok: true, refunded: 0, dryRun, message: "No stale bets found" });
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        wouldRefund: bets.length,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        bets: bets.map((b: any) => ({
          id: b.id,
          userId: b.userId,
          gameType: b.gameType,
          stakeGzo: Number(b.stakeGzo),
          createdAt: b.createdAt,
          minutesAgo: Math.round((Date.now() - new Date(b.createdAt).getTime()) / 60000),
        })),
      });
    }

    const results: Array<{ betId: string; userId: string; stakeGzo: number; ok: boolean; error?: string }> = [];

    for (const bet of bets) {
      const stakeGzo = Number(bet.stakeGzo);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (prisma as any).$transaction(async (tx: any) => {
          // Credit stake back to player wallet
          const wallet = await tx.walletBalance.findUniqueOrThrow({
            where: { userId: bet.userId },
          });
          const balBefore = Number(wallet.balance);
          const balAfter = balBefore + stakeGzo;

          await tx.walletBalance.update({
            where: { userId: bet.userId },
            data:  { balance: String(balAfter) },
          });

          await tx.ledgerEntry.create({
            data: {
              userId:        bet.userId,
              type:          LedgerEntryType.BET_REFUND,
              amount:        String(stakeGzo),
              balanceBefore: String(balBefore),
              balanceAfter:  String(balAfter),
              reference:     `vrf-refund:${bet.id}`,
            },
          });

          await tx.gameBet.update({
            where: { id: bet.id },
            data:  {
              status:    "REFUNDED",
              settledAt: new Date(),
              resultJson: {
                ...(bet.resultJson ?? {}),
                refundReason: "vrf_timeout",
                refundedAt: new Date().toISOString(),
              },
            },
          });
        });

        results.push({ betId: bet.id, userId: bet.userId, stakeGzo, ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        console.error(`admin/refund-stale-bets: failed to refund bet ${bet.id}:`, err);
        results.push({ betId: bet.id, userId: bet.userId, stakeGzo, ok: false, error: msg });
      }
    }

    const succeeded = results.filter(r => r.ok).length;
    const failed    = results.filter(r => !r.ok).length;

    return NextResponse.json({
      ok: failed === 0,
      refunded: succeeded,
      failed,
      results,
    });
  } catch (err) {
    console.error("admin/refund-stale-bets POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
