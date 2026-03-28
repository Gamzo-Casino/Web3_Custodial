/**
 * POST /api/games/dice/bet
 *
 * Custodial dice bet flow:
 *  1. Validate request & check DB balance
 *  2. Debit stake from DB atomically (LedgerEntry + WalletBalance)
 *  3. Call DiceGame.placeBetFor() on-chain using house wallet (no token pull from player)
 *  4. Store pending GameBet with on-chain roundId
 *  5. Return roundId — frontend polls /api/games/dice/status/[roundId] for VRF result
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { getPublicClient, getHouseWalletClient, DICE_GAME_ABI } from "@/lib/viemServer";
import { parseEther, formatEther } from "viem";
import { z } from "zod";

const DICE_GAME_ADDRESS = "0x4b87dF81A498ed204590f9aF25b8889cd0cBC5f7" as const;

const bodySchema = z.object({
  stakeGzo:     z.number().int().min(1).max(100_000),
  /** Win condition: roll < target. Range [1.01, 98.00] */
  target:       z.number().min(1.01).max(98.0),
  mode:         z.literal("ROLL_UNDER"),
});

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = authUser.userId;

  // Player's wallet address is used as the on-chain `player` field for auditability
  const walletAddress = authUser.walletAddress;
  if (!walletAddress) {
    return NextResponse.json(
      { error: "Wallet connection required. Sign in with your wallet to play on-chain dice." },
      { status: 400 }
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { stakeGzo: stake, target, mode } = body;
  const targetScaled = Math.round(target * 100); // e.g. 50.00 → 5000

  // ── 1. Check DB balance & debit stake atomically ───────────────────────────
  let betId: string;
  let idempotencyKey: string;

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

      const key = `dice-chain:${userId}:${Date.now()}`;
      const bet = await tx.gameBet.create({
        data: {
          userId,
          gameType:      "DICE",
          stakeGzo:      String(stake),
          status:        "PENDING",
          idempotencyKey: key,
          contractAddress: DICE_GAME_ADDRESS,
          chainId:         80002,
          resultJson: { target, mode, targetScaled },
        },
      });

      return { balanceBefore, balanceAfter, betId: bet.id, idempotencyKey: key };
    });

    betId           = dbResult.betId;
    idempotencyKey  = dbResult.idempotencyKey;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "DB error";
    if (msg === "Insufficient balance") {
      return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
    }
    console.error("dice/bet DB debit error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // ── 2. Call DiceGame.placeBetFor() on-chain ────────────────────────────────
  // NOTE: Do NOT use simulateContract result for roundId — block.timestamp differs
  // between simulate (eth_call) and actual mine (next block). Instead, parse the
  // BetPlaced event from the confirmed receipt to get the real on-chain roundId.
  const stakeWei = parseEther(String(stake));
  const targetBig = BigInt(targetScaled);

  let roundId: string;
  let txHash: string;

  try {
    const publicClient = getPublicClient();
    const { client: walletClient, account } = getHouseWalletClient();

    // Simulate only for pre-flight validation (revert detection), discard result
    const { request } = await publicClient.simulateContract({
      address:      DICE_GAME_ADDRESS,
      abi:          DICE_GAME_ABI,
      functionName: "placeBetFor",
      args:         [walletAddress as `0x${string}`, stakeWei, targetBig],
      account,
      gas:          1_500_000n, // VRF requestRandomWords requires ~1M gasleft(); bypass failing eth_estimateGas
    });

    // Send transaction
    txHash = await walletClient.writeContract(request);

    // Wait for receipt and parse the BetPlaced event to get the real roundId
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash as `0x${string}`,
      timeout: 60_000,
    });

    // Parse logs using viem's decodeEventLog to find the BetPlaced event
    const { decodeEventLog } = await import("viem");
    let parsedRoundId: string | null = null;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== DICE_GAME_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi:     DICE_GAME_ABI,
          data:    log.data,
          topics:  log.topics,
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
    // On-chain call failed — refund stake to player
    const errMsg = err instanceof Error ? err.message : "On-chain error";
    console.error("dice/bet on-chain error:", err);

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
      console.error("dice/bet CRITICAL: refund failed after on-chain error:", refundErr);
    }

    // Surface the actual contract revert reason to the client for debuggability
    const friendlyMsg = errMsg.includes("house insolvent")
      ? "House temporarily unavailable. Try again shortly."
      : errMsg.includes("stake out of range")
      ? "Stake is outside the allowed range (1–100,000 GZO)."
      : errMsg.includes("invalid target")
      ? "Invalid target value."
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
        resultJson: { target, mode, targetScaled, placedTxHash: txHash },
      },
    });
  } catch (err) {
    // Non-fatal: bet is already on-chain; status endpoint will still work via roundId
    console.error("dice/bet: failed to update GameBet with roundId:", err);
  }

  return NextResponse.json({
    ok:      true,
    betId,
    roundId,
    txHash,
    stake,
    target,
    targetScaled,
    stakeEth: formatEther(stakeWei),
  });
}
