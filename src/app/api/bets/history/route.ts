import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/walletSession";
import { prisma } from "@/lib/prismaClient";

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const game = searchParams.get("game") ?? undefined;
  const limitParam = parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 20 : limitParam), 50);

  const userId = session.userId;

  try {
    const bets = await (prisma as any).gameBet.findMany({
      where: {
        userId,
        status: { not: "PENDING" },
        ...(game ? { gameType: game } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const formatted = bets.map((bet: any) => {
      const stake = bet.stakeGzo != null ? Number(bet.stakeGzo) : null;
      const net = bet.netPayoutGzo != null ? Number(bet.netPayoutGzo) : null;
      return {
        id: bet.id,
        gameType: bet.gameType,
        stakeGzo: stake,
        netPayoutGzo: net,
        profitGzo: bet.profitGzo != null ? Number(bet.profitGzo) : null,
        won: net !== null && stake !== null ? net > stake : false,
        status: bet.status,
        onchainRoundId: bet.onchainRoundId,
        txHash: bet.txHash,
        chainId: bet.chainId,
        contractAddress: bet.contractAddress ?? null,
        createdAt: bet.createdAt instanceof Date ? bet.createdAt.toISOString() : bet.createdAt,
        settledAt: bet.settledAt instanceof Date ? bet.settledAt.toISOString() : bet.settledAt ?? null,
        resultJson: bet.resultJson ?? null,
      };
    });

    return NextResponse.json({ bets: formatted });
  } catch (err: any) {
    console.error("[bets/history] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
