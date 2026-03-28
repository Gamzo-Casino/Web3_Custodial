/**
 * POST /api/games/blackjack/settle
 *
 * Called by the frontend when the player finishes all actions (stand/bust/double).
 * 1. Loads current BlackjackRound from DB
 * 2. Runs dealer play (server-side mirror of contract rules)
 * 3. Derives card deck positions from stored deck via indexOf (each card is unique)
 * 4. Calls BlackjackGame.settleRound() on-chain — contract verifies cards + determines payout
 * 5. Reads netPayout from RoundSettled event → credits DB balance (idempotent)
 * 6. Returns final game state
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { getPublicClient, getHouseWalletClient, BLACKJACK_GAME_ABI } from "@/lib/viemServer";
import { formatEther } from "viem";
import {
  cardFromIndex,
  dealerPlay,
  compareHands,
  handGrossPayout,
  buildGameState,
  type HandOutcome,
} from "@/lib/blackjack";
import { settle } from "@/lib/settlement";

const BLACKJACK_GAME_ADDRESS = "0x370Af2cB87AFC8BDA70Daba1198c16e40C62CBC3" as const;

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authUser.userId;

  // ── 1. Load active BlackjackRound from DB ─────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const round = await (prisma as any).blackjackRound.findFirst({
    where: { userId, status: "ACTIVE" },
  });
  if (!round) {
    return NextResponse.json({ error: "No active round" }, { status: 400 });
  }

  const onchainRoundId = round.serverSeedHash as string;
  if (!onchainRoundId || !/^0x[0-9a-fA-F]{64}$/.test(onchainRoundId)) {
    return NextResponse.json({ error: "Round missing on-chain ID" }, { status: 500 });
  }

  // Idempotency: if already settled on-chain, return existing state
  if (round.status === "SETTLED") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wallet = await (prisma as any).walletBalance.findUnique({ where: { userId } });
    return NextResponse.json({ ok: true, ...buildGameState(round, wallet ? Number(wallet.balance) : 0) });
  }

  // ── 2. Compute dealer play and final card arrays ───────────────────────────
  const deckValues:   number[] = JSON.parse(round.deckJson   as string);
  const playerValues: number[] = JSON.parse(round.playerCards as string);
  const dealerValues: number[] = JSON.parse(round.dealerCards as string);
  const splitValues:  number[] | null = round.splitCards
    ? JSON.parse(round.splitCards as string) : null;

  const deckIndex = round.deckIndex as number;
  const { finalCardValues: dealerFinal } = dealerPlay(dealerValues, deckValues, deckIndex);

  // ── 3. Derive deck positions via indexOf (each card value is unique 0-51) ──
  function getPositions(cardValueArr: number[]): number[] {
    return cardValueArr.map((v) => {
      const pos = deckValues.indexOf(v);
      if (pos === -1) throw new Error(`Card ${v} not found in deck`);
      return pos;
    });
  }

  let playerPositions: number[];
  let dealerPositions: number[];
  let splitPositions:  number[];

  try {
    playerPositions = getPositions(playerValues);
    dealerPositions = getPositions(dealerFinal);
    splitPositions  = splitValues ? getPositions(splitValues) : [];
  } catch (err) {
    console.error("blackjack/settle: position derivation error:", err);
    return NextResponse.json({ error: "Failed to derive card positions" }, { status: 500 });
  }

  const didDouble  = Boolean(round.mainDoubled);
  const hasSplit   = splitValues !== null && splitValues.length > 0;

  // ── 4. Call settleRound() on-chain ────────────────────────────────────────
  let netPayoutGzo = 0;
  let txHash = "";

  try {
    const publicClient = getPublicClient();
    const { client: walletClient, account } = getHouseWalletClient();

    const { request } = await publicClient.simulateContract({
      address:      BLACKJACK_GAME_ADDRESS,
      abi:          BLACKJACK_GAME_ABI,
      functionName: "settleRound",
      args: [
        onchainRoundId as `0x${string}`,
        playerValues   as unknown as readonly number[],
        dealerFinal    as unknown as readonly number[],
        playerPositions as unknown as readonly number[],
        dealerPositions as unknown as readonly number[],
        (splitValues ?? []) as unknown as readonly number[],
        splitPositions      as unknown as readonly number[],
        didDouble,
      ],
      account,
    });

    txHash = await walletClient.writeContract(request);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash:    txHash as `0x${string}`,
      timeout: 90_000,
    });

    // Parse RoundSettled event for netPayout
    const { decodeEventLog } = await import("viem");
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== BLACKJACK_GAME_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi:       BLACKJACK_GAME_ABI,
          data:      log.data,
          topics:    log.topics,
          eventName: "RoundSettled",
        });
        const args = decoded.args as { netPayout: bigint };
        netPayoutGzo = Number(formatEther(args.netPayout));
        break;
      } catch {
        // not RoundSettled, skip
      }
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "On-chain error";
    console.error("blackjack/settle on-chain error:", err);
    return NextResponse.json({ error: `Settlement error: ${errMsg.slice(0, 200)}` }, { status: 500 });
  }

  // ── 5. Compute outcomes for DB record ────────────────────────────────────
  const playerCards = playerValues.map(cardFromIndex);
  const dealerCards = dealerFinal.map(cardFromIndex);
  const splitCards  = splitValues ? splitValues.map(cardFromIndex) : null;

  const mainStake   = Number(round.mainStakeGzo);
  const splitStake  = splitCards ? Number(round.splitStakeGzo) : 0;
  const totalStake  = mainStake + splitStake;

  const mainOutcome:  HandOutcome        = compareHands(playerCards, dealerCards, false);
  const splitOutcome: HandOutcome | null = splitCards
    ? compareHands(splitCards, dealerCards, true)
    : null;

  const mainGross  = handGrossPayout(mainStake,  mainOutcome);
  const splitGross = splitOutcome ? handGrossPayout(splitStake, splitOutcome) : 0;
  const totalGross = mainGross + splitGross;

  const { profitGzo, feeGzo } = settle(totalStake, totalGross);

  // ── 6. Credit DB balance and mark round SETTLED ───────────────────────────
  let balanceAfter = 0;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settled = await (prisma as any).$transaction(async (tx: any) => {
      const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
      const balBefore = Number(wallet.balance);
      let newBalance = balBefore;

      if (netPayoutGzo > 0) {
        newBalance = balBefore + netPayoutGzo;
        await tx.walletBalance.update({
          where: { userId },
          data:  { balance: String(newBalance) },
        });
        await tx.ledgerEntry.create({
          data: {
            userId,
            type:          LedgerEntryType.BET_WON,
            amount:        String(netPayoutGzo),
            balanceBefore: String(balBefore),
            balanceAfter:  String(newBalance),
            reference:     `blackjack-win:${onchainRoundId}`,
          },
        });
      }

      const now = new Date();
      const actionLog = JSON.parse((round.actions as string) || "[]");
      actionLog.push({ action: "settle", mainOutcome, splitOutcome, timestamp: now.toISOString() });

      const updatedRound = await tx.blackjackRound.update({
        where: { id: round.id },
        data: {
          status:         "SETTLED",
          mainOutcome,
          splitOutcome,
          dealerCards:    JSON.stringify(dealerFinal),
          grossPayoutGzo: String(totalGross),
          profitGzo:      String(profitGzo),
          feeGzo:         String(feeGzo),
          netPayoutGzo:   String(netPayoutGzo),
          settledAt:      now,
          actions:        JSON.stringify(actionLog),
        },
      });

      // Update GameBet
      await tx.gameBet.updateMany({
        where: { onchainRoundId, userId, status: "PENDING" },
        data: {
          status:             "SETTLED",
          settledAt:          now,
          netPayoutGzo:       String(netPayoutGzo),
          grossPayoutGzo:     String(totalGross),
          feeGzo:             String(feeGzo),
          profitGzo:          String(netPayoutGzo - totalStake),
          txHash,
          resultJson: {
            mainOutcome, splitOutcome,
            playerCards:   playerValues,
            dealerCards:   dealerFinal,
            splitCards:    splitValues,
            mainStakeGzo:  mainStake,
            splitStakeGzo: splitCards ? splitStake : null,
            netPayoutGzo,
            totalGross,
            onChain: true,
          },
        },
      });

      return { updatedRound, balanceAfter: newBalance };
    });

    balanceAfter = settled.balanceAfter;

    return NextResponse.json({
      ok: true,
      ...buildGameState(settled.updatedRound, balanceAfter),
      netPayoutGzo,
      mainOutcome,
      splitOutcome,
    });
  } catch (err) {
    console.error("blackjack/settle DB settlement error:", err);
    return NextResponse.json({ error: "Settlement DB error" }, { status: 500 });
  }
}
