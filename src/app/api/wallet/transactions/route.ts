/**
 * GET /api/wallet/transactions
 * Returns up to 25 most recent deposits and withdrawals for the authenticated user,
 * merged and sorted newest-first.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/walletSession";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [deposits, withdrawals] = await Promise.all([
      (prisma as any).deposit.findMany({
        where: { userId: session.userId },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          txHash: true,
          amountGzo: true,
          status: true,
          createdAt: true,
          confirmedAt: true,
        },
      }),
      (prisma as any).withdrawalRequest.findMany({
        where: { userId: session.userId },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          txHash: true,
          amountGzo: true,
          status: true,
          createdAt: true,
          processedAt: true,
        },
      }),
    ]);

    // Merge and tag each row with its type, then sort by createdAt desc
    const merged = [
      ...deposits.map((d: any) => ({
        id: d.id,
        type: "DEPOSIT" as const,
        txHash: d.txHash ?? null,
        amountGzo: Number(d.amountGzo),
        status: d.status,
        createdAt: d.createdAt,
      })),
      ...withdrawals.map((w: any) => ({
        id: w.id,
        type: "WITHDRAWAL" as const,
        txHash: w.txHash ?? null,
        amountGzo: Number(w.amountGzo),
        status: w.status,
        createdAt: w.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 25);

    return NextResponse.json({ transactions: merged });
  } catch (err) {
    console.error("[wallet/transactions] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
