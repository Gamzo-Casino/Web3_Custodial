/**
 * POST /api/games/blackjack/start
 *
 * Custodial Blackjack start flow:
 *  1. Validate request & check DB balance
 *  2. Debit total stake from DB atomically (LedgerEntry + WalletBalance)
 *  3. House wallet calls BlackjackGame.startRoundFor() on-chain (Chainlink VRF triggered)
 *  4. Store pending GameBet with on-chain roundId
 *  5. Return roundId — frontend polls /api/games/blackjack/status?roundId=... for VRF result
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { creditHouseTx, debitHouseTx, HouseLedgerType } from "@/lib/house";
import { getPublicClient, getHouseWalletClient, BLACKJACK_GAME_ABI } from "@/lib/viemServer";
import { parseEther } from "viem";
import { z } from "zod";

const BLACKJACK_GAME_ADDRESS = "0x370Af2cB87AFC8BDA70Daba1198c16e40C62CBC3" as const;

const bodySchema = z.object({
  stakeGzo: z.number().int().min(1).max(100_000),
});

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = authUser.userId;
  const walletAddress = authUser.walletAddress;
  if (!walletAddress) {
    return NextResponse.json(
      { error: "Wallet connection required. Sign in with your wallet to play on-chain Blackjack." },
      { status: 400 }
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { stakeGzo: stake } = body;

  // Check for existing active round
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (prisma as any).blackjackRound.findFirst({
    where: { userId, status: "ACTIVE" },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Active Blackjack hand already in progress." },
      { status: 400 }
    );
  }

  // ── 1. Debit stake from DB atomically ─────────────────────────────────────
  let betId: string;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbResult = await (prisma as any).$transaction(async (tx: any) => {
      const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
      const balanceBefore = Number(wallet.balance);
      if (balanceBefore < stake) throw new Error("Insufficient balance");

      const balanceAfter = balanceBefore - stake;
      await tx.walletBalance.update({
        where: { userId },
        data:  { balance: String(balanceAfter) },
      });

      await tx.ledgerEntry.create({
        data: {
          userId,
          type:          LedgerEntryType.BET_PLACED,
          amount:        String(stake),
          balanceBefore: String(balanceBefore),
          balanceAfter:  String(balanceAfter),
          reference:     null,
        },
      });

      await creditHouseTx(tx, stake, HouseLedgerType.BET_IN);

      const key = `blackjack-chain:${userId}:${Date.now()}`;
      const bet = await tx.gameBet.create({
        data: {
          userId,
          gameType:        "BLACKJACK",
          stakeGzo:        String(stake),
          status:          "PENDING",
          idempotencyKey:  key,
          contractAddress: BLACKJACK_GAME_ADDRESS,
          chainId:         80002,
          resultJson:      { stake },
        },
      });

      return { betId: bet.id };
    });

    betId = dbResult.betId;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "DB error";
    if (msg === "Insufficient balance") {
      return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
    }
    console.error("blackjack/start DB debit error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // ── 2. Call BlackjackGame.startRoundFor() on-chain ────────────────────────
  const stakeWei = parseEther(String(stake));
  let roundId: string;
  let txHash: string;

  try {
    const publicClient = getPublicClient();
    const { client: walletClient, account } = getHouseWalletClient();

    const { request } = await publicClient.simulateContract({
      address:      BLACKJACK_GAME_ADDRESS,
      abi:          BLACKJACK_GAME_ABI,
      functionName: "startRoundFor",
      args:         [walletAddress as `0x${string}`, stakeWei],
      account,
      gas:          1_500_000n, // VRF requestRandomWords requires ~1M gasleft(); bypass failing eth_estimateGas
    });

    txHash = await walletClient.writeContract(request);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash:    txHash as `0x${string}`,
      timeout: 60_000,
    });

    const { decodeEventLog } = await import("viem");
    let parsedRoundId: string | null = null;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== BLACKJACK_GAME_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi:       BLACKJACK_GAME_ABI,
          data:      log.data,
          topics:    log.topics,
          eventName: "RoundStarted",
        });
        parsedRoundId = (decoded.args as { roundId: string }).roundId;
        break;
      } catch {
        // not RoundStarted, skip
      }
    }

    if (!parsedRoundId) throw new Error("RoundStarted event not found in receipt");
    roundId = parsedRoundId;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "On-chain error";
    console.error("blackjack/start on-chain error:", err);

    // Refund stake on failure
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).$transaction(async (tx: any) => {
        const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
        const bal = Number(wallet.balance);
        await tx.walletBalance.update({
          where: { userId },
          data:  { balance: String(bal + stake) },
        });
        await tx.ledgerEntry.create({
          data: {
            userId,
            type:          LedgerEntryType.BET_REFUND,
            amount:        String(stake),
            balanceBefore: String(bal),
            balanceAfter:  String(bal + stake),
            reference:     `refund:${betId}`,
          },
        });
        await debitHouseTx(tx, stake, HouseLedgerType.BET_REFUND, `refund:${betId}`);
        await tx.gameBet.update({
          where: { id: betId },
          data:  { status: "REFUNDED", settledAt: new Date() },
        });
      });
    } catch (refundErr) {
      console.error("blackjack/start CRITICAL: refund failed after on-chain error:", refundErr);
    }

    const friendlyMsg = errMsg.includes("stake out of range")
      ? "Stake is outside the allowed range (1–100,000 GZO)."
      : errMsg.includes("active round exists")
      ? "You already have an active blackjack round on-chain."
      : errMsg.includes("OPERATOR_ROLE")
      ? "Server configuration error: operator role not set."
      : `On-chain error: ${errMsg.slice(0, 120)}`;
    return NextResponse.json({ error: friendlyMsg }, { status: 500 });
  }

  // ── 3. Link on-chain roundId to DB record ──────────────────────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).gameBet.update({
      where: { id: betId },
      data:  {
        onchainRoundId: roundId,
        txHash,
        resultJson: { stake, placedTxHash: txHash },
      },
    });
  } catch (err) {
    console.error("blackjack/start: failed to update GameBet with roundId:", err);
  }

  return NextResponse.json({
    ok:      true,
    betId,
    roundId,
    txHash,
    stake,
  });
}
