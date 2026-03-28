import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { buildHiloState } from "@/lib/hilo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authUser.userId;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const round = await (prisma as any).hiloRound.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });

    if (!round) {
      // Check for PENDING GameBet (VRF not yet fulfilled)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pendingBet = await (prisma as any).gameBet.findFirst({
        where: { userId, gameType: "HILO", status: "PENDING" },
        orderBy: { createdAt: "desc" },
      });
      if (pendingBet?.onchainRoundId) {
        return NextResponse.json({
          round:   null,
          pending: { roundId: pendingBet.onchainRoundId },
        });
      }
      return NextResponse.json({ round: null });
    }

    return NextResponse.json({ round: buildHiloState(round) });
  } catch (err) {
    console.error("hilo/current error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
