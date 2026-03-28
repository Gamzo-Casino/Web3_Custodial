import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Returns recent settled Mines rounds for the authenticated player. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rounds = await (prisma as any).minesRound.findMany({
      where: { userId, status: { not: "ACTIVE" } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return NextResponse.json({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rounds: rounds.map((r: any) => ({
        id: r.id,
        stakeGzo: Number(r.stakeGzo),
        mineCount: r.mineCount,
        boardSize: r.boardSize,
        status: r.status,
        revealedTiles: JSON.parse(r.revealedTiles as string),
        minePositions: JSON.parse(r.minePositions as string), // safe to reveal after game
        multiplierPath: JSON.parse(r.multiplierPath as string),
        currentMultiplier: Number(r.currentMultiplier),
        grossPayoutGzo: r.grossPayoutGzo != null ? Number(r.grossPayoutGzo) : null,
        profitGzo: r.profitGzo != null ? Number(r.profitGzo) : null,
        feeGzo: r.feeGzo != null ? Number(r.feeGzo) : null,
        netPayoutGzo: r.netPayoutGzo != null ? Number(r.netPayoutGzo) : null,
        serverSeedHash: r.serverSeedHash,
        serverSeed: r.serverSeed, // revealed since game is over
        clientSeed: r.clientSeed,
        nonce: r.nonce,
        publicSeed: r.publicSeed,
        createdAt: r.createdAt.toISOString(),
        settledAt: r.settledAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    console.error("mines/history error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
