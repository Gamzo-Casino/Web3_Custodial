/**
 * POST /api/games/wheel/spin
 *
 * Custodial Wheel spin flow:
 *  1. Validate request & check DB balance
 *  2. Debit stake from DB atomically (LedgerEntry + WalletBalance)
 *  3. Call WheelGame.spinFor() on-chain using house wallet
 *  4. Store pending GameBet with on-chain roundId
 *  5. Return roundId — frontend polls /api/games/wheel/status?roundId=... for VRF result
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { creditHouseTx, debitHouseTx, HouseLedgerType } from "@/lib/house";
import { getPublicClient, getHouseWalletClient, WHEEL_GAME_ABI } from "@/lib/viemServer";
import { parseEther, formatEther } from "viem";
import { z } from "zod";

const WHEEL_GAME_ADDRESS = "0x98c304b90f14c69275014eb22Eb60694d07184a2" as const;
const RISK_MODE_MAP: Record<string, number> = { low: 0, medium: 1, high: 2 };

const bodySchema = z.object({
  stakeGzo: z.number().int().min(1).max(100_000),
  risk: z.enum(["low", "medium", "high"]),
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
      { error: "Wallet connection required to play Wheel." },
      { status: 400 }
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { stakeGzo: stake, risk } = body;
  const riskMode = RISK_MODE_MAP[risk];

  // ── 1. Check DB balance & debit stake atomically ───────────────────────────
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

      const bet = await tx.gameBet.create({
        data: {
          userId,
          gameType:        "WHEEL",
          stakeGzo:        String(stake),
          status:          "PENDING",
          idempotencyKey:  `wheel-c:${userId}:${Date.now()}`,
          contractAddress: WHEEL_GAME_ADDRESS,
          chainId:         80002,
          resultJson:      { risk, riskMode },
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
    console.error("wheel/spin DB debit error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // ── 2. Call WheelGame.spinFor() on-chain ──────────────────────────────────
  const stakeWei = parseEther(String(stake));
  let roundId: string;
  let txHash: string;

  try {
    const publicClient = getPublicClient();
    const { client: walletClient, account } = getHouseWalletClient();

    const { request } = await publicClient.simulateContract({
      address:      WHEEL_GAME_ADDRESS,
      abi:          WHEEL_GAME_ABI,
      functionName: "spinFor",
      args:         [walletAddress as `0x${string}`, stakeWei, riskMode],
      account,
      gas:          1_500_000n,
    });

    txHash = await walletClient.writeContract(request);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash:    txHash as `0x${string}`,
      timeout: 60_000,
    });

    const { decodeEventLog } = await import("viem");
    let parsedRoundId: string | null = null;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== WHEEL_GAME_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi:       WHEEL_GAME_ABI,
          data:      log.data,
          topics:    log.topics,
          eventName: "BetPlaced",
        });
        parsedRoundId = (decoded.args as { roundId: string }).roundId;
        break;
      } catch {
        // not BetPlaced, skip
      }
    }

    if (!parsedRoundId) throw new Error("BetPlaced event not found in receipt");
    roundId = parsedRoundId;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "On-chain error";
    console.error("wheel/spin on-chain error:", err);

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
      console.error("wheel/spin CRITICAL: refund failed after on-chain error:", refundErr);
    }

    const isLowFunds = errMsg.includes("exceeds the balance") || errMsg.includes("insufficient funds");
    const displayMsg = isLowFunds
      ? "House wallet has insufficient MATIC. Please try again later."
      : `Spin error: ${errMsg.slice(0, 120)}`;
    return NextResponse.json({ error: displayMsg }, { status: 500 });
  }

  // ── 3. Link on-chain roundId to DB record ─────────────────────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).gameBet.update({
      where: { id: betId },
      data:  {
        onchainRoundId: roundId,
        txHash,
        resultJson: { risk, riskMode, placedTxHash: txHash },
      },
    });
  } catch (err) {
    console.error("wheel/spin: failed to update GameBet with roundId:", err);
  }

  return NextResponse.json({
    ok:    true,
    betId,
    roundId,
    txHash,
    stake,
    risk,
    stakeEth: formatEther(stakeWei),
  });
}
