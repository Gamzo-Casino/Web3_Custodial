import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { getPublicClient, getHouseWalletClient, HILO_GAME_ABI } from "@/lib/viemServer";
import { formatEther } from "viem";
import { buildHiloState } from "@/lib/hilo";
import { z } from "zod";

const HILO_GAME_ADDRESS = "0x8572650a140f27F481aFA0359877cEE99d08d241" as const;

const bodySchema = z.object({
  roundId: z.string().min(1),
});

function guessToCode(g: string): number {
  if (g === "higher") return 0;
  if (g === "lower")  return 1;
  return 2;
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
  const { roundId } = body;

  // ── 1. Load active HiloRound ────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const round = await (prisma as any).hiloRound.findUnique({ where: { id: roundId } });
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (round.userId !== userId) return NextResponse.json({ error: "Not your round" }, { status: 403 });
  if (round.status !== "ACTIVE") return NextResponse.json({ error: "Round is not active" }, { status: 400 });

  const guessHistory = JSON.parse(
    typeof round.guessHistory === "string"
      ? round.guessHistory
      : JSON.stringify(round.guessHistory ?? [])
  );

  if (guessHistory.length === 0) {
    return NextResponse.json({ error: "Make at least one correct guess before cashing out" }, { status: 400 });
  }

  const onchainRoundId = round.serverSeedHash as string;
  if (!onchainRoundId || !/^0x[0-9a-fA-F]{64}$/.test(onchainRoundId)) {
    return NextResponse.json({ error: "Round missing on-chain ID" }, { status: 500 });
  }

  // ── 2. Build on-chain cashout arguments ────────────────────────────────────
  // cards[0..n] = deck[0..deckIndex-1], positions[i] = i (unique Fisher-Yates deck)
  const deck: number[] = JSON.parse(round.deckJson as string);
  const deckIndex: number = round.deckIndex;

  // Cards revealed so far: starting card + all guessed cards
  const cards = deck.slice(0, deckIndex);         // deck[0..deckIndex-1]
  const positions = Array.from({ length: deckIndex }, (_, i) => i);
  const guessCodes = guessHistory.map((e: { guess: string }) => guessToCode(e.guess));
  const cashoutAt = guessHistory.length; // all guesses were correct

  // ── 3. Call cashout() on-chain ───────────────────────────────────────────────
  let netPayoutGzo = 0;
  let txHash = "";

  try {
    const publicClient = getPublicClient();
    const { client: walletClient, account } = getHouseWalletClient();

    const { request } = await publicClient.simulateContract({
      address:      HILO_GAME_ADDRESS,
      abi:          HILO_GAME_ABI,
      functionName: "cashout",
      args: [
        onchainRoundId as `0x${string}`,
        cards     as unknown as readonly number[],
        positions as unknown as readonly number[],
        guessCodes as unknown as readonly number[],
        BigInt(cashoutAt),
      ],
      account,
    });

    txHash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash:    txHash as `0x${string}`,
      timeout: 90_000,
    });

    // Parse RoundCashedOut event for netPayout
    const { decodeEventLog } = await import("viem");
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== HILO_GAME_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi:       HILO_GAME_ABI,
          data:      log.data,
          topics:    log.topics,
          eventName: "RoundCashedOut",
        });
        const args = decoded.args as { netPayout: bigint };
        netPayoutGzo = Math.floor(Number(formatEther(args.netPayout)));
        break;
      } catch {
        // not RoundCashedOut, skip
      }
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "On-chain error";
    console.error("hilo/cashout on-chain error:", err);
    return NextResponse.json({ error: `Cashout error: ${errMsg.slice(0, 200)}` }, { status: 500 });
  }

  // ── 4. Credit DB balance and mark round CASHED_OUT ──────────────────────────
  const stake = Number(round.stakeGzo);
  const currentMultiplier = Number(round.currentMultiplier);
  const grossPayout = Math.floor(stake * currentMultiplier);
  const profitGzo = netPayoutGzo - stake;
  const feeGzo = grossPayout - netPayoutGzo;
  const now = new Date();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settled = await (prisma as any).$transaction(async (tx: any) => {
      const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
      const balanceBefore = Number(wallet.balance);
      let newBalance = balanceBefore;

      if (netPayoutGzo > 0) {
        newBalance = balanceBefore + netPayoutGzo;
        await tx.walletBalance.update({
          where: { userId },
          data:  { balance: String(newBalance) },
        });
        await tx.ledgerEntry.create({
          data: {
            userId,
            type:          LedgerEntryType.BET_WON,
            amount:        String(netPayoutGzo),
            balanceBefore: String(balanceBefore),
            balanceAfter:  String(newBalance),
            reference:     roundId,
          },
        });
      }

      const updatedRound = await tx.hiloRound.update({
        where: { id: roundId },
        data: {
          status:         "CASHED_OUT",
          grossPayoutGzo: String(grossPayout),
          profitGzo:      String(profitGzo),
          feeGzo:         String(feeGzo),
          netPayoutGzo:   String(netPayoutGzo),
          settledAt:      now,
        },
      });

      await tx.gameBet.create({
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
          settledAt:          now,
          txHash,
          resultJson: {
            outcome: "CASHED_OUT",
            guessHistory,
            finalMultiplier: currentMultiplier,
            rngVersion: round.rngVersion,
            onChain: true,
          },
          grossPayoutGzo: String(grossPayout),
          profitGzo:      String(profitGzo),
          feeGzo:         String(feeGzo),
          netPayoutGzo:   String(netPayoutGzo),
        },
      });

      return { updatedRound, balanceAfter: newBalance };
    });

    return NextResponse.json({
      ok: true,
      ...buildHiloState(settled.updatedRound, settled.balanceAfter),
      netPayoutGzo,
    });
  } catch (err) {
    console.error("hilo/cashout DB settlement error:", err);
    return NextResponse.json({ error: "Settlement DB error" }, { status: 500 });
  }
}
