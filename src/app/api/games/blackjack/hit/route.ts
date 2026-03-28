import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import {
  cardFromIndex,
  isBust,
  buildGameState,
} from "@/lib/blackjack";

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

      const activeHand    = round.activeHand as number;
      const mainDoubled   = round.mainDoubled  as boolean;
      const splitDoubled  = round.splitDoubled as boolean;
      const currentDoubled = activeHand === 0 ? mainDoubled : splitDoubled;

      if (currentDoubled) throw new Error("INVALID_ACTION");

      const deckValues: number[] = JSON.parse(round.deckJson as string);
      const deckIndex  = round.deckIndex as number;

      if (deckIndex >= deckValues.length) throw new Error("DECK_EXHAUSTED");

      const newCard    = deckValues[deckIndex];
      const newDeckIdx = deckIndex + 1;

      const now = new Date();
      const actionLog = JSON.parse((round.actions as string) || "[]");
      actionLog.push({ action: "hit", hand: activeHand, cardValue: newCard, timestamp: now.toISOString() });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let updatedRound: any;

      if (activeHand === 0) {
        const currentCards: number[] = JSON.parse(round.playerCards as string);
        const newCards = [...currentCards, newCard];

        if (isBust(newCards.map(cardFromIndex))) {
          const splitCards: number[] | null = round.splitCards
            ? JSON.parse(round.splitCards as string) : null;

          if (splitCards) {
            // Switch to split hand — main hand busted
            actionLog.push({ action: "switch_to_split", reason: "bust", timestamp: now.toISOString() });
            updatedRound = await tx.blackjackRound.update({
              where: { id: round.id },
              data: {
                playerCards: JSON.stringify(newCards),
                deckIndex:   newDeckIdx,
                activeHand:  1,
                actions:     JSON.stringify(actionLog),
              },
            });
            return buildGameState(updatedRound);
          } else {
            // No split — game over, needs on-chain settle
            updatedRound = await tx.blackjackRound.update({
              where: { id: round.id },
              data: {
                playerCards: JSON.stringify(newCards),
                deckIndex:   newDeckIdx,
                actions:     JSON.stringify(actionLog),
              },
            });
            return { ...buildGameState(updatedRound), gameOver: true };
          }
        } else {
          updatedRound = await tx.blackjackRound.update({
            where: { id: round.id },
            data: {
              playerCards: JSON.stringify(newCards),
              deckIndex:   newDeckIdx,
              actions:     JSON.stringify(actionLog),
            },
          });
          return buildGameState(updatedRound);
        }
      } else {
        // Hitting on split hand (activeHand === 1)
        const currentSplit: number[] = JSON.parse(round.splitCards as string);
        const newSplit = [...currentSplit, newCard];

        if (isBust(newSplit.map(cardFromIndex))) {
          // Split hand busted — game over, needs on-chain settle
          updatedRound = await tx.blackjackRound.update({
            where: { id: round.id },
            data: {
              splitCards: JSON.stringify(newSplit),
              deckIndex:  newDeckIdx,
              actions:    JSON.stringify(actionLog),
            },
          });
          return { ...buildGameState(updatedRound), gameOver: true };
        } else {
          updatedRound = await tx.blackjackRound.update({
            where: { id: round.id },
            data: {
              splitCards: JSON.stringify(newSplit),
              deckIndex:  newDeckIdx,
              actions:    JSON.stringify(actionLog),
            },
          });
          return buildGameState(updatedRound);
        }
      }
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    if (msg === "NO_ACTIVE_ROUND") return NextResponse.json({ error: "No active round" }, { status: 400 });
    if (msg === "INVALID_ACTION") return NextResponse.json({ error: "Cannot hit after doubling" }, { status: 400 });
    if (msg === "DECK_EXHAUSTED")  return NextResponse.json({ error: "Deck exhausted" }, { status: 500 });
    console.error("blackjack/hit error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
