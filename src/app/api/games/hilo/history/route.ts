import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hiloCardFromIndex } from "@/lib/hilo";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rounds = await (prisma as any).hiloRound.findMany({
      where: { userId, NOT: { status: "ACTIVE" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        stakeGzo: true,
        status: true,
        currentMultiplier: true,
        guessHistory: true,
        deckJson: true,
        deckIndex: true,
        grossPayoutGzo: true,
        profitGzo: true,
        netPayoutGzo: true,
        createdAt: true,
        settledAt: true,
        serverSeedHash: true,
        nonce: true,
      },
    });

    const history = rounds.map((r: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const deck: number[] = JSON.parse(r.deckJson as string);
      const finalCard = hiloCardFromIndex(deck[(r.deckIndex as number) - 1]);
      const guessHistory = JSON.parse(
        typeof r.guessHistory === "string" ? r.guessHistory : JSON.stringify(r.guessHistory ?? [])
      );
      return {
        id: r.id,
        stakeGzo: Number(r.stakeGzo),
        status: r.status,
        finalMultiplier: Number(r.currentMultiplier),
        guessCount: guessHistory.length,
        finalCard,
        grossPayoutGzo: r.grossPayoutGzo != null ? Number(r.grossPayoutGzo) : null,
        profitGzo: r.profitGzo != null ? Number(r.profitGzo) : null,
        netPayoutGzo: r.netPayoutGzo != null ? Number(r.netPayoutGzo) : null,
        createdAt: r.createdAt,
        settledAt: r.settledAt,
        serverSeedHash: r.serverSeedHash,
        nonce: r.nonce,
      };
    });

    return NextResponse.json({ history });
  } catch (err) {
    console.error("hilo/history error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
