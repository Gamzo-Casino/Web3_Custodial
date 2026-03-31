import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { getPublicClient, getHouseWalletClient, HILO_GAME_ABI } from "@/lib/viemServer";
import {
  hiloCardFromIndex,
  evaluateGuess,
  getGuessMultiplier,
  buildHiloState,
  type HiloGuessHistoryEntry,
} from "@/lib/hilo";
import { z } from "zod";

const HILO_GAME_ADDRESS = "0x8572650a140f27F481aFA0359877cEE99d08d241" as const;

const bodySchema = z.object({
  roundId: z.string().min(1),
  guess: z.enum(["higher", "lower", "same"]),
});

function guessToCode(g: string): number {
  if (g === "higher") return 0;
  if (g === "lower")  return 1;
  return 2; // same
}

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authUser.userId;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { roundId, guess } = body;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const round = await tx.hiloRound.findUniqueOrThrow({ where: { id: roundId } });

      if (round.userId !== userId) throw new Error("Not your round");
      if (round.status !== "ACTIVE") throw new Error("Round is not active");

      const deck: number[] = JSON.parse(round.deckJson as string);
      const deckIndex: number = round.deckIndex;

      if (deckIndex >= deck.length) throw new Error("Deck exhausted");

      const currentCardIdx = deck[deckIndex - 1];
      const nextCardIdx = deck[deckIndex];
      const currentCard = hiloCardFromIndex(currentCardIdx);
      const nextCard = hiloCardFromIndex(nextCardIdx);

      const guessResult = evaluateGuess(currentCard.value, nextCard.value, guess);
      const perGuessMultiplier = getGuessMultiplier(currentCard.value, guess);
      const currentMultiplier = Number(round.currentMultiplier);

      const guessHistory: HiloGuessHistoryEntry[] = JSON.parse(
        typeof round.guessHistory === "string"
          ? round.guessHistory
          : JSON.stringify(round.guessHistory ?? [])
      );

      const newMultiplierOnWin = Math.floor(currentMultiplier * perGuessMultiplier * 100) / 100;

      const historyEntry: HiloGuessHistoryEntry = {
        guess,
        result: guessResult,
        cardBefore: currentCard,
        cardAfter: nextCard,
        multiplierBefore: currentMultiplier,
        multiplierAfter: guessResult === "win" ? newMultiplierOnWin : currentMultiplier,
      };
      guessHistory.push(historyEntry);

      const newDeckIndex = deckIndex + 1;

      if (guessResult === "loss") {
        const stake = Number(round.stakeGzo);
        const now = new Date();

        const updatedRound = await tx.hiloRound.update({
          where: { id: roundId },
          data: {
            deckIndex:      newDeckIndex,
            guessHistory:   JSON.stringify(guessHistory),
            status:         "LOST",
            grossPayoutGzo: "0",
            profitGzo:      String(-stake),
            feeGzo:         "0",
            netPayoutGzo:   "0",
            settledAt:      now,
          },
        });

        // Build on-chain loseRound data
        // cards = deck[0..newDeckIndex-1], positions = [0,1,...,newDeckIndex-1]
        const lostAtStep = deckIndex - 1; // 0-indexed index of the wrong guess
        const cards = deck.slice(0, newDeckIndex);
        const positions = Array.from({ length: newDeckIndex }, (_, i) => i);
        // All guesses including the losing one
        const prevGuessCodes = guessHistory.slice(0, -1).map(e => guessToCode(e.guess));
        const allGuessCodes = [...prevGuessCodes, guessToCode(guess)];

        const onchainRoundId = round.serverSeedHash as string;

        const createdBet = await tx.gameBet.create({
          data: {
            userId,
            gameType:           "HILO",
            stakeGzo:           String(stake),
            status:             "SETTLED",
            idempotencyKey:     `hilo-settle:${roundId}`,
            serverSeedHash:     round.serverSeedHash,
            serverSeedRevealed: round.serverSeed,
            clientSeed:         round.clientSeed,
            nonce:              round.nonce,
            publicSeed:         round.publicSeed,
            referenceId:        roundId,
            onchainRoundId,
            chainId:            80002,
            contractAddress:    HILO_GAME_ADDRESS,
            settledAt:          now,
            resultJson: {
              outcome:      "LOST",
              steps:        guessHistory.length,
              multiplier100: 0,
              guessHistory,
              finalCard: nextCard,
              rngVersion: round.rngVersion,
            },
            grossPayoutGzo: "0",
            profitGzo:      String(-stake),
            feeGzo:         "0",
            netPayoutGzo:   "0",
          },
        });

        return {
          updatedRound,
          loseBetId: createdBet.id,
          loseOnchain: { onchainRoundId, cards, positions, guesses: allGuessCodes, lostAtStep },
        };
      }

      // ── Win: advance multiplier and continue ─────────────────────────────
      const updatedRound = await tx.hiloRound.update({
        where: { id: roundId },
        data: {
          deckIndex:         newDeckIndex,
          currentMultiplier: String(newMultiplierOnWin),
          guessHistory:      JSON.stringify(guessHistory),
        },
      });

      return { updatedRound, loseBetId: null, loseOnchain: null };
    });

    // ── Call loseRound() on-chain if lost — capture txHash to update GameBet ─
    if (result.loseOnchain) {
      const { onchainRoundId, cards, positions, guesses: guessCodes, lostAtStep } = result.loseOnchain;
      if (onchainRoundId && /^0x[0-9a-fA-F]{64}$/.test(onchainRoundId)) {
        try {
          const publicClient = getPublicClient();
          const { client: walletClient, account } = getHouseWalletClient();

          const { request } = await publicClient.simulateContract({
            address:      HILO_GAME_ADDRESS,
            abi:          HILO_GAME_ABI,
            functionName: "loseRound",
            args: [
              onchainRoundId as `0x${string}`,
              cards     as unknown as readonly number[],
              positions as unknown as readonly number[],
              guessCodes as unknown as readonly number[],
              BigInt(lostAtStep),
            ],
            account,
          });
          const loseTxHash = await walletClient.writeContract(request);
          // Update GameBet with the on-chain txHash (non-fatal if this fails)
          if (result.loseBetId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (prisma as any).gameBet.update({
              where: { id: result.loseBetId },
              data:  { txHash: loseTxHash },
            }).catch((e: unknown) => console.error("hilo/guess txHash update error:", e));
          }
        } catch (err) {
          console.error("hilo/guess loseRound on-chain error (non-fatal):", err);
        }
      }
    }

    return NextResponse.json({ ok: true, ...buildHiloState(result.updatedRound) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    const clientErrors = ["Not your round", "Round is not active", "Deck exhausted"];
    if (clientErrors.includes(msg)) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("hilo/guess error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
