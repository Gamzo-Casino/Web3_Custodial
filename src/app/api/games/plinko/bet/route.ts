/**
 * POST /api/games/plinko/bet
 *
 * Custodial plinko bet flow:
 *  1. Validate request & check DB balance
 *  2. Debit stake from DB atomically (LedgerEntry + WalletBalance)
 *  3. Call PlinkoGame.dropBallFor() on-chain using house wallet (no token pull from player)
 *  4. Store pending GameBet with on-chain roundId
 *  5. Return roundId — frontend polls /api/games/plinko/status?roundId=... for VRF result
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { creditHouseTx, debitHouseTx, HouseLedgerType } from "@/lib/house";
import { getPublicClient, getHouseWalletClient, PLINKO_GAME_ABI } from "@/lib/viemServer";
import { parseEther, formatEther } from "viem";
import { z } from "zod";

const PLINKO_GAME_ADDRESS = "0x8e10fE2d7E642d21eAd14ff52F2ADD38e00c23de" as const;

const RISK_TO_UINT8: Record<string, number> = { low: 0, med: 1, high: 2 };

const bodySchema = z.object({
  stakeGzo: z.number().int().min(1).max(100_000),
  rows:     z.union([z.literal(8), z.literal(12), z.literal(16)]),
  risk:     z.enum(["low", "med", "high"]),
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
      { error: "Wallet connection required. Sign in with your wallet to play on-chain Plinko." },
      { status: 400 }
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { stakeGzo: stake, rows, risk } = body;
  const riskUint8 = RISK_TO_UINT8[risk];

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

      await creditHouseTx(tx, stake, HouseLedgerType.BET_IN);

      const key = `plinko-chain:${userId}:${Date.now()}`;
      const bet = await tx.gameBet.create({
        data: {
          userId,
          gameType:        "PLINKO",
          stakeGzo:        String(stake),
          status:          "PENDING",
          idempotencyKey:  key,
          contractAddress: PLINKO_GAME_ADDRESS,
          chainId:         80002,
          resultJson:      { rows, risk, riskUint8 },
        },
      });

      return { balanceBefore, balanceAfter, betId: bet.id, idempotencyKey: key };
    });

    betId          = dbResult.betId;
    idempotencyKey = dbResult.idempotencyKey;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "DB error";
    if (msg === "Insufficient balance") {
      return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
    }
    console.error("plinko/bet DB debit error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // ── 2. Call PlinkoGame.dropBallFor() on-chain ─────────────────────────────
  const stakeWei = parseEther(String(stake));

  let roundId: string;
  let txHash: string;

  try {
    const publicClient = getPublicClient();
    const { client: walletClient, account } = getHouseWalletClient();

    // Simulate only for pre-flight validation (revert detection), discard result
    const { request } = await publicClient.simulateContract({
      address:      PLINKO_GAME_ADDRESS,
      abi:          PLINKO_GAME_ABI,
      functionName: "dropBallFor",
      args:         [walletAddress as `0x${string}`, stakeWei, rows, riskUint8],
      account,
      gas:          1_500_000n, // VRF requestRandomWords requires ~1M gasleft(); bypass failing eth_estimateGas
    });

    // Send transaction
    txHash = await walletClient.writeContract(request);

    // Wait for receipt and parse BetPlaced event to get real roundId
    const receipt = await publicClient.waitForTransactionReceipt({
      hash:    txHash as `0x${string}`,
      timeout: 60_000,
    });

    const { decodeEventLog } = await import("viem");
    let parsedRoundId: string | null = null;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== PLINKO_GAME_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi:       PLINKO_GAME_ABI,
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
    // On-chain call failed — refund stake to player
    const errMsg = err instanceof Error ? err.message : "On-chain error";
    console.error("plinko/bet on-chain error:", err);

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
      console.error("plinko/bet CRITICAL: refund failed after on-chain error:", refundErr);
    }

    const friendlyMsg = errMsg.includes("stake out of range")
      ? "Stake is outside the allowed range (1–100,000 GZO)."
      : errMsg.includes("invalid rows")
      ? "Invalid rows value. Choose 8, 12, or 16."
      : errMsg.includes("invalid risk")
      ? "Invalid risk value."
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
        resultJson: { rows, risk, riskUint8, placedTxHash: txHash },
      },
    });
  } catch (err) {
    console.error("plinko/bet: failed to update GameBet with roundId:", err);
  }

  return NextResponse.json({
    ok:       true,
    betId,
    roundId,
    txHash,
    stake,
    rows,
    risk,
    stakeEth: formatEther(stakeWei),
  });
}
