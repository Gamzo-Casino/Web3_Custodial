import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { getPublicClient, getHouseWalletClient, BLACKJACK_GAME_ABI } from "@/lib/viemServer";
import { cardFromIndex, canSplitHand, buildGameState } from "@/lib/blackjack";

const BLACKJACK_GAME_ADDRESS = "0x370Af2cB87AFC8BDA70Daba1198c16e40C62CBC3" as const;

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authUser.userId;

  // ── 1. DB update + extra stake debit ────────────────────────────────────────
  let roundId: string;
  let onchainRoundId: string;
  let updatedRound: unknown;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbResult = await (prisma as any).$transaction(async (tx: any) => {
      const round = await tx.blackjackRound.findFirst({
        where: { userId, status: "ACTIVE" },
      });
      if (!round) throw new Error("NO_ACTIVE_ROUND");

      const activeHand  = round.activeHand as number;
      const mainDoubled = round.mainDoubled  as boolean;

      if (activeHand !== 0)   throw new Error("INVALID_ACTION");
      if (round.splitCards)   throw new Error("ALREADY_SPLIT");
      if (mainDoubled)        throw new Error("INVALID_ACTION");

      const mainCards: number[] = JSON.parse(round.playerCards as string);
      if (mainCards.length !== 2) throw new Error("INVALID_ACTION");
      if (!canSplitHand(mainCards.map(cardFromIndex))) throw new Error("CANNOT_SPLIT");

      const splitExtra = Number(round.stakeGzo);

      const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
      const balanceBefore = Number(wallet.balance);
      if (balanceBefore < splitExtra) throw new Error("Insufficient balance");
      const newBalance = balanceBefore - splitExtra;

      await tx.walletBalance.update({ where: { userId }, data: { balance: String(newBalance) } });
      await tx.ledgerEntry.create({
        data: {
          userId,
          type:          LedgerEntryType.BET_PLACED,
          amount:        String(splitExtra),
          balanceBefore: String(balanceBefore),
          balanceAfter:  String(newBalance),
          reference:     null,
        },
      });

      // Draw 1 card each for the 2 new hands
      const deckValues: number[] = JSON.parse(round.deckJson as string);
      const deckIndex = round.deckIndex as number;
      if (deckIndex + 1 >= deckValues.length) throw new Error("DECK_EXHAUSTED");

      const card0 = deckValues[deckIndex];       // new main hand second card
      const card1 = deckValues[deckIndex + 1];   // new split hand second card
      const newDeckIdx = deckIndex + 2;

      const newMainCards  = [mainCards[0], card0];
      const newSplitCards = [mainCards[1], card1];

      const now = new Date();
      const actionLog = JSON.parse((round.actions as string) || "[]");
      actionLog.push({
        action: "split",
        mainCards: newMainCards,
        splitCards: newSplitCards,
        timestamp: now.toISOString(),
      });

      const updated = await tx.blackjackRound.update({
        where: { id: round.id },
        data: {
          playerCards:   JSON.stringify(newMainCards),
          splitCards:    JSON.stringify(newSplitCards),
          splitStakeGzo: String(splitExtra),
          deckIndex:     newDeckIdx,
          activeHand:    0,
          actions:       JSON.stringify(actionLog),
        },
      });

      return { round: updated, onchainRoundId: round.serverSeedHash as string };
    });

    roundId       = dbResult.round.id;
    onchainRoundId = dbResult.onchainRoundId;
    updatedRound  = dbResult.round;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    if (msg === "NO_ACTIVE_ROUND")  return NextResponse.json({ error: "No active round" }, { status: 400 });
    if (msg === "ALREADY_SPLIT")    return NextResponse.json({ error: "Already split" }, { status: 400 });
    if (msg === "CANNOT_SPLIT")     return NextResponse.json({ error: "Cannot split these cards" }, { status: 400 });
    if (msg === "INVALID_ACTION")   return NextResponse.json({ error: "Cannot split" }, { status: 400 });
    if (msg === "Insufficient balance") return NextResponse.json({ error: msg }, { status: 400 });
    console.error("blackjack/split DB error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // ── 2. Call lockSplitFor() on-chain ────────────────────────────────────────
  try {
    const publicClient = getPublicClient();
    const { client: walletClient, account } = getHouseWalletClient();

    const { request } = await publicClient.simulateContract({
      address:      BLACKJACK_GAME_ADDRESS,
      abi:          BLACKJACK_GAME_ABI,
      functionName: "lockSplitFor",
      args:         [onchainRoundId as `0x${string}`],
      account,
    });

    const txHash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({
      hash:    txHash as `0x${string}`,
      timeout: 60_000,
    });
  } catch (err) {
    console.error("blackjack/split lockSplitFor error (non-fatal):", err);
    // Non-fatal: the split is in DB; on-chain lockSplitFor failure will be caught at settle time
  }

  return NextResponse.json({ ok: true, ...buildGameState(updatedRound) });
}
