import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { getPublicClient, getHouseWalletClient, HILO_GAME_ABI } from "@/lib/viemServer";
import { parseEther } from "viem";
import { z } from "zod";

const HILO_GAME_ADDRESS = "0x8572650a140f27F481aFA0359877cEE99d08d241" as const;

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
    return NextResponse.json({ error: "Wallet address required" }, { status: 400 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { stakeGzo: stake } = body;

  // Reject if active round exists in DB
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingRound = await (prisma as any).hiloRound.findFirst({
    where: { userId, status: "ACTIVE" },
  });
  if (existingRound) {
    return NextResponse.json(
      { error: "Active Hilo round already in progress. Cashout or let it end first." },
      { status: 400 }
    );
  }

  // ── 1. DB debit + create pending GameBet ────────────────────────────────────
  let betId: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbResult = await (prisma as any).$transaction(async (tx: any) => {
      const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
      const balanceBefore = Number(wallet.balance);
      if (balanceBefore < stake) throw new Error("Insufficient balance");
      const newBalance = balanceBefore - stake;

      await tx.walletBalance.update({ where: { userId }, data: { balance: String(newBalance) } });
      await tx.ledgerEntry.create({
        data: {
          userId,
          type:          LedgerEntryType.BET_PLACED,
          amount:        String(stake),
          balanceBefore: String(balanceBefore),
          balanceAfter:  String(newBalance),
          reference:     null,
        },
      });

      const bet = await tx.gameBet.create({
        data: {
          userId,
          gameType:       "HILO",
          stakeGzo:       String(stake),
          status:         "PENDING",
          idempotencyKey: `hilo:start:${userId}:${Date.now()}`,
        },
      });

      return { betId: bet.id };
    });

    betId = dbResult.betId;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    if (msg === "Insufficient balance") return NextResponse.json({ error: msg }, { status: 400 });
    console.error("hilo/start DB error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // ── 2. Call startRoundFor() on-chain ─────────────────────────────────────────
  const stakeWei = parseEther(String(stake));
  let onchainRoundId: string;
  let txHash: string;

  try {
    const publicClient = getPublicClient();
    const { client: walletClient, account } = getHouseWalletClient();

    const { request } = await publicClient.simulateContract({
      address:      HILO_GAME_ADDRESS,
      abi:          HILO_GAME_ABI,
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

    // Decode RoundStarted event to get roundId
    const { decodeEventLog } = await import("viem");
    let foundRoundId: string | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== HILO_GAME_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi:       HILO_GAME_ABI,
          data:      log.data,
          topics:    log.topics,
          eventName: "RoundStarted",
        });
        foundRoundId = (decoded.args as { roundId: string }).roundId;
        break;
      } catch {
        // not RoundStarted, skip
      }
    }
    if (!foundRoundId) throw new Error("RoundStarted event not found");
    onchainRoundId = foundRoundId;
  } catch (err) {
    // Compensating refund
    console.error("hilo/start on-chain error:", err);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).$transaction(async (tx: any) => {
        const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
        const balanceBefore = Number(wallet.balance);
        const newBalance = balanceBefore + stake;
        await tx.walletBalance.update({ where: { userId }, data: { balance: String(newBalance) } });
        await tx.ledgerEntry.create({
          data: {
            userId,
            type:          LedgerEntryType.BET_REFUND,
            amount:        String(stake),
            balanceBefore: String(balanceBefore),
            balanceAfter:  String(newBalance),
            reference:     betId,
          },
        });
        await tx.gameBet.update({ where: { id: betId }, data: { status: "REFUNDED" } });
      });
    } catch (refundErr) {
      console.error("hilo/start refund error:", refundErr);
    }
    const errMsg = err instanceof Error ? err.message : "On-chain error";
    const isLowFunds = errMsg.includes("exceeds the balance") || errMsg.includes("insufficient funds");
    const displayMsg = isLowFunds
      ? "House wallet has insufficient MATIC. Please fund 0xF2050102401849d615e1855A9FAd4327CDeeF2cF on Polygon Amoy."
      : `Start error: ${errMsg.slice(0, 400)}`;
    return NextResponse.json({ error: displayMsg }, { status: 500 });
  }

  // ── 3. Update GameBet with on-chain roundId ─────────────────────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).gameBet.update({
      where: { id: betId },
      data:  { onchainRoundId, txHash },
    });
  } catch (err) {
    console.error("hilo/start gameBet update error (non-fatal):", err);
  }

  return NextResponse.json({ ok: true, betId, onchainRoundId, stake });
}
