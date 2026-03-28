import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { isBust, cardFromIndex, buildGameState } from "@/lib/blackjack";

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authUser.userId;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const round = await tx.blackjackRound.findFirst({
        where: { userId, status: "ACTIVE" },
      });
      if (!round) throw new Error("NO_ACTIVE_ROUND");

      const activeHand = round.activeHand as number;
      const now = new Date();
      const actionLog = JSON.parse((round.actions as string) || "[]");
      actionLog.push({ action: "stand", hand: activeHand, timestamp: now.toISOString() });

      if (activeHand === 0 && round.splitCards) {
        // Player standing on main hand while split hand exists — switch to split hand
        actionLog.push({ action: "switch_to_split", timestamp: now.toISOString() });
        const updatedRound = await tx.blackjackRound.update({
          where: { id: round.id },
          data: { activeHand: 1, actions: JSON.stringify(actionLog) },
        });
        return buildGameState(updatedRound);
      }

      // Validate: active hand should not be busted (safety guard)
      const activeCards: number[] = activeHand === 0
        ? JSON.parse(round.playerCards as string)
        : JSON.parse(round.splitCards as string);
      if (isBust(activeCards.map(cardFromIndex))) throw new Error("INVALID_ACTION");

      // All player hands done — signal game over for on-chain settle
      const updatedRound = await tx.blackjackRound.update({
        where: { id: round.id },
        data: { actions: JSON.stringify(actionLog) },
      });
      return { ...buildGameState(updatedRound), gameOver: true };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    if (msg === "NO_ACTIVE_ROUND") return NextResponse.json({ error: "No active round" }, { status: 400 });
    if (msg === "INVALID_ACTION")  return NextResponse.json({ error: "Cannot stand on bust hand" }, { status: 400 });
    console.error("blackjack/stand error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
