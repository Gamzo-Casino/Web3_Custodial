import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rounds = await (prisma as any).rouletteRound.findMany({
      where: { userId, status: "SETTLED" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true, winningNumber: true, winningColor: true,
        totalStakeGzo: true, profitGzo: true, netPayoutGzo: true,
        createdAt: true, wagers: true, payoutBreakdown: true,
        feeGzo: true, grossPayoutGzo: true,
        serverSeedHash: true, clientSeed: true, nonce: true,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = rounds.map((r: any) => ({
      id: r.id,
      winningNumber: r.winningNumber,
      winningColor: r.winningColor,
      totalStakeGzo: Number(r.totalStakeGzo),
      profitGzo: r.profitGzo != null ? Number(r.profitGzo) : null,
      netPayoutGzo: r.netPayoutGzo != null ? Number(r.netPayoutGzo) : null,
      feeGzo: r.feeGzo != null ? Number(r.feeGzo) : null,
      grossPayoutGzo: r.grossPayoutGzo != null ? Number(r.grossPayoutGzo) : null,
      createdAt: r.createdAt.toISOString(),
      wagers: typeof r.wagers === "string" ? JSON.parse(r.wagers) : r.wagers,
      payoutBreakdown: typeof r.payoutBreakdown === "string" ? JSON.parse(r.payoutBreakdown) : r.payoutBreakdown,
      serverSeedHash: r.serverSeedHash,
      clientSeed: r.clientSeed,
      nonce: r.nonce,
    }));
    return NextResponse.json({ rounds: mapped });
  } catch (err) {
    console.error("roulette/history error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
