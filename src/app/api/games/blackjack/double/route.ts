import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { cardFromIndex, isBust, buildGameState } from "@/lib/blackjack";

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

      const activeHand   = round.activeHand as number;
      const mainDoubled  = round.mainDoubled  as boolean;
      const splitDoubled = round.splitDoubled as boolean;
      const currentDoubled = activeHand === 0 ? mainDoubled : splitDoubled;

      const mainCards: number[]  = JSON.parse(round.playerCards as string);
      const splitCards: number[] | null = round.splitCards ? JSON.parse(round.splitCards as string) : null;
      const activeCards = activeHand === 0 ? mainCards : (splitCards ?? []);

      if (currentDoubled)           throw new Error("ALREADY_DOUBLED");
      if (activeCards.length !== 2) throw new Error("INVALID_ACTION");
      if (isBust(activeCards.map(cardFromIndex))) throw new Error("INVALID_ACTION");

      // Extra debit = current hand stake
      const extraStake = activeHand === 0 ? Number(round.mainStakeGzo) : Number(round.splitStakeGzo);

      const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
      const balanceBefore = Number(wallet.balance);
      if (balanceBefore < extraStake) throw new Error("Insufficient balance");
      const newBalance = balanceBefore - extraStake;

      await tx.walletBalance.update({ where: { userId }, data: { balance: String(newBalance) } });
      await tx.ledgerEntry.create({
        data: {
          userId,
          type:          LedgerEntryType.BET_PLACED,
          amount:        String(extraStake),
          balanceBefore: String(balanceBefore),
          balanceAfter:  String(newBalance),
          reference:     null,
        },
      });

      // Draw exactly 1 card
      const deckValues: number[] = JSON.parse(round.deckJson as string);
      const deckIndex = round.deckIndex as number;
      if (deckIndex >= deckValues.length) throw new Error("DECK_EXHAUSTED");

      const newCard    = deckValues[deckIndex];
      const newDeckIdx = deckIndex + 1;

      const now = new Date();
      const actionLog = JSON.parse((round.actions as string) || "[]");
      actionLog.push({ action: "double", hand: activeHand, cardValue: newCard, extraStake, timestamp: now.toISOString() });

      let updatedData: Record<string, unknown>;
      let newActiveCards: number[];

      if (activeHand === 0) {
        newActiveCards = [...mainCards, newCard];
        updatedData = {
          playerCards:   JSON.stringify(newActiveCards),
          mainStakeGzo:  String(Number(round.mainStakeGzo) * 2),
          mainDoubled:   true,
          deckIndex:     newDeckIdx,
          actions:       JSON.stringify(actionLog),
        };
      } else {
        newActiveCards = [...(splitCards ?? []), newCard];
        updatedData = {
          splitCards:    JSON.stringify(newActiveCards),
          splitStakeGzo: String(Number(round.splitStakeGzo) * 2),
          splitDoubled:  true,
          deckIndex:     newDeckIdx,
          actions:       JSON.stringify(actionLog),
        };
      }

      let updatedRound = await tx.blackjackRound.update({
        where: { id: round.id },
        data: updatedData,
      });

      // After double: forced stand — either switch hand or signal game over
      if (isBust(newActiveCards.map(cardFromIndex))) {
        if (activeHand === 0 && splitCards) {
          // Main busted, switch to split
          const switchLog = JSON.parse((updatedRound.actions as string) || "[]");
          switchLog.push({ action: "switch_to_split", reason: "bust", timestamp: now.toISOString() });
          updatedRound = await tx.blackjackRound.update({
            where: { id: round.id },
            data: { activeHand: 1, actions: JSON.stringify(switchLog) },
          });
          return buildGameState(updatedRound);
        }
        // Bust — game over
        return { ...buildGameState(updatedRound), gameOver: true };
      }

      // No bust — forced stand: switch hand or game over
      if (activeHand === 0 && splitCards) {
        const switchLog = JSON.parse((updatedRound.actions as string) || "[]");
        switchLog.push({ action: "switch_to_split", reason: "double_stand", timestamp: now.toISOString() });
        updatedRound = await tx.blackjackRound.update({
          where: { id: round.id },
          data: { activeHand: 1, actions: JSON.stringify(switchLog) },
        });
        return buildGameState(updatedRound);
      }

      return { ...buildGameState(updatedRound), gameOver: true };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    if (msg === "NO_ACTIVE_ROUND")  return NextResponse.json({ error: "No active round" }, { status: 400 });
    if (msg === "ALREADY_DOUBLED")  return NextResponse.json({ error: "Already doubled" }, { status: 400 });
    if (msg === "INVALID_ACTION")   return NextResponse.json({ error: "Cannot double down" }, { status: 400 });
    if (msg === "Insufficient balance") return NextResponse.json({ error: msg }, { status: 400 });
    console.error("blackjack/double error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
