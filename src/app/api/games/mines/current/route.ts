import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Returns the player's active custodial Mines round from DB (mine positions hidden). */
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authUser.userId;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bet = await (prisma as any).gameBet.findFirst({
      where:   { userId, gameType: "MINES", status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });

    if (!bet) return NextResponse.json({ round: null });

    const resultJson = bet.resultJson as {
      mineCount: number;
      revealedTiles?: number[];
      multiplierPath?: number[];
    };
    const revealedTiles  = resultJson.revealedTiles  ?? [];
    const multiplierPath = resultJson.multiplierPath ?? [];

    return NextResponse.json({
      round: {
        id:               bet.id,
        roundId:          bet.onchainRoundId,
        stakeGzo:         Number(bet.stakeGzo),
        mineCount:        resultJson.mineCount,
        boardSize:        25,
        revealedTiles,
        multiplierPath,
        currentMultiplier: multiplierPath.length > 0
          ? multiplierPath[multiplierPath.length - 1]
          : 1,
        status:           "PENDING",
        createdAt:        bet.createdAt.toISOString(),
        minePositions:    null, // NEVER expose in current (fetched via /status once VRF ready)
      },
    });
  } catch (err) {
    console.error("mines/current error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
