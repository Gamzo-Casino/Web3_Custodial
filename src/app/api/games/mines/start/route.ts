/**
 * POST /api/games/mines/start
 *
 * Custodial Mines bet flow:
 *  1. Validate request & check DB balance
 *  2. Debit stake from DB atomically (LedgerEntry + WalletBalance)
 *  3. Call MinesGame.startRoundFor() on-chain using house wallet
 *  4. Store pending GameBet with on-chain roundId
 *  5. Return roundId — frontend polls /api/games/mines/status?roundId=... for VRF
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { creditHouseTx, HouseLedgerType } from "@/lib/house";
import { getPublicClient, getHouseWalletClient, MINES_GAME_ABI } from "@/lib/viemServer";
import { parseEther } from "viem";
import { z } from "zod";

const MINES_GAME_ADDRESS = "0x55d8093C2e75E682f6183EC78e4D35641010046f" as const;

const bodySchema = z.object({
  stakeGzo:  z.number().int().min(1).max(100_000),
  mineCount: z.number().int().min(1).max(24),
});

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId       = authUser.userId;
  const walletAddress = authUser.walletAddress;
  if (!walletAddress) {
    return NextResponse.json(
      { error: "Wallet connection required. Sign in with your wallet to play on-chain Mines." },
      { status: 400 }
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { stakeGzo: stake, mineCount } = body;

  // ── 1. Check DB balance & debit stake atomically ──────────────────────────
  let betId: string;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbResult = await (prisma as any).$transaction(async (tx: any) => {
      // Reject if an active custodial round already exists
      const existing = await tx.gameBet.findFirst({
        where: { userId, gameType: "MINES", status: "PENDING" },
      });
      if (existing) {
        throw new Error("Active Mines round already exists. Wait for it to complete.");
      }

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

      const key = `mines-chain:${userId}:${Date.now()}`;
      const bet = await tx.gameBet.create({
        data: {
          userId,
          gameType:        "MINES",
          stakeGzo:        String(stake),
          status:          "PENDING",
          idempotencyKey:  key,
          contractAddress: MINES_GAME_ADDRESS,
          chainId:         80002,
          resultJson:      { mineCount },
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
    if (msg.includes("Active Mines round")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("mines/start DB debit error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // ── 2. Call MinesGame.startRoundFor() on-chain ────────────────────────────
  const stakeWei = parseEther(String(stake));

  let roundId: string;
  let txHash: string;

  try {
    const publicClient = getPublicClient();
    const { client: walletClient, account } = getHouseWalletClient();

    const { request } = await publicClient.simulateContract({
      address:      MINES_GAME_ADDRESS,
      abi:          MINES_GAME_ABI,
      functionName: "startRoundFor",
      args:         [walletAddress as `0x${string}`, stakeWei, mineCount],
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
      if (log.address.toLowerCase() !== MINES_GAME_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi:       MINES_GAME_ABI,
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
    console.error("mines/start on-chain error:", err);

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
        await tx.gameBet.update({
          where: { id: betId },
          data:  { status: "REFUNDED", settledAt: new Date() },
        });
      });
    } catch (refundErr) {
      console.error("mines/start CRITICAL: refund failed after on-chain error:", refundErr);
    }

    const friendlyMsg = errMsg.includes("stake out of range")
      ? "Stake is outside the allowed range (1–100,000 GZO)."
      : errMsg.includes("invalid mine count")
      ? "Mine count must be between 1 and 24."
      : errMsg.includes("active round exists")
      ? "An active round already exists on-chain. Complete it first."
      : errMsg.includes("OPERATOR_ROLE")
      ? "Server configuration error: operator role not set."
      : `On-chain error: ${errMsg.slice(0, 120)}`;
    return NextResponse.json({ error: friendlyMsg }, { status: 500 });
  }

  // ── 3. Link on-chain roundId to DB record ─────────────────────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).gameBet.update({
      where: { id: betId },
      data:  {
        onchainRoundId: roundId,
        txHash,
        resultJson: { mineCount, startTxHash: txHash },
      },
    });
  } catch (err) {
    console.error("mines/start: failed to update GameBet with roundId:", err);
  }

  return NextResponse.json({
    ok:       true,
    betId,
    roundId,
    txHash,
    stake,
    mineCount,
    status:   "PENDING",
  });
}
