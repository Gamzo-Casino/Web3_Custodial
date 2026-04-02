/**
 * POST /api/games/roulette/spin
 *
 * Custodial Roulette spin flow:
 *  1. Validate request & check DB balance
 *  2. Debit total stake from DB atomically (LedgerEntry + WalletBalance)
 *  3. House wallet calls RouletteGame.spinFor() on-chain (Chainlink VRF triggered)
 *  4. Store pending GameBet with on-chain roundId
 *  5. Return roundId — frontend polls /api/games/roulette/status?roundId=... for VRF result
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { creditHouseTx, debitHouseTx, HouseLedgerType } from "@/lib/house";
import { getPublicClient, getHouseWalletClient, ROULETTE_GAME_ABI } from "@/lib/viemServer";
import { parseEther, formatEther } from "viem";
import { isValidArea } from "@/lib/roulette";
import { z } from "zod";

const ROULETTE_GAME_ADDRESS = "0x13CeBf51251547A048DF83A5561a0361822e298b" as const;

const wagerSchema = z.object({
  area:  z.string().min(1).max(32),
  stake: z.number().int().min(1).max(100_000),
});

const bodySchema = z.object({
  wagers: z.array(wagerSchema).min(1).max(15),
});

function areaToBetType(area: string): number {
  if (area.startsWith("straight:")) return parseInt(area.split(":")[1], 10) + 12;
  const MAP: Record<string, number> = {
    red: 0, black: 1, odd: 2, even: 3,
    low: 4, high: 5,
    dozen1: 6, dozen2: 7, dozen3: 8,
    col1: 9, col2: 10, col3: 11,
  };
  return MAP[area] ?? 0;
}

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = authUser.userId;
  const walletAddress = authUser.walletAddress;
  if (!walletAddress) {
    return NextResponse.json(
      { error: "Wallet connection required. Sign in with your wallet to play on-chain Roulette." },
      { status: 400 }
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { wagers } = body;

  // Validate all bet areas
  for (const w of wagers) {
    if (!isValidArea(w.area)) {
      return NextResponse.json({ error: `Invalid bet area: ${w.area}` }, { status: 400 });
    }
  }

  const totalStake = wagers.reduce((s, w) => s + w.stake, 0);

  // ── 1. Check DB balance & debit stake atomically ───────────────────────────
  let betId: string;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbResult = await (prisma as any).$transaction(async (tx: any) => {
      const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
      const balanceBefore = Number(wallet.balance);
      if (balanceBefore < totalStake) throw new Error("Insufficient balance");

      const balanceAfter = balanceBefore - totalStake;
      await tx.walletBalance.update({
        where: { userId },
        data:  { balance: String(balanceAfter) },
      });

      await tx.ledgerEntry.create({
        data: {
          userId,
          type:          LedgerEntryType.BET_PLACED,
          amount:        String(totalStake),
          balanceBefore: String(balanceBefore),
          balanceAfter:  String(balanceAfter),
          reference:     null,
        },
      });

      await creditHouseTx(tx, totalStake, HouseLedgerType.BET_IN);

      const key = `roulette-chain:${userId}:${Date.now()}`;
      const bet = await tx.gameBet.create({
        data: {
          userId,
          gameType:        "ROULETTE",
          stakeGzo:        String(totalStake),
          status:          "PENDING",
          idempotencyKey:  key,
          contractAddress: ROULETTE_GAME_ADDRESS,
          chainId:         80002,
          resultJson:      { wagers },
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
    console.error("roulette/spin DB debit error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // ── 2. Call RouletteGame.spinFor() on-chain ────────────────────────────────
  const betTypes  = wagers.map(w => areaToBetType(w.area));
  const stakesWei = wagers.map(w => parseEther(String(w.stake)));

  let roundId: string;
  let txHash: string;

  try {
    const publicClient = getPublicClient();
    const { client: walletClient, account } = getHouseWalletClient();

    const { request } = await publicClient.simulateContract({
      address:      ROULETTE_GAME_ADDRESS,
      abi:          ROULETTE_GAME_ABI,
      functionName: "spinFor",
      args:         [walletAddress as `0x${string}`, betTypes, stakesWei],
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
      if (log.address.toLowerCase() !== ROULETTE_GAME_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi:       ROULETTE_GAME_ABI,
          data:      log.data,
          topics:    log.topics,
          eventName: "SpinPlaced",
        });
        parsedRoundId = (decoded.args as { roundId: string }).roundId;
        break;
      } catch {
        // not SpinPlaced, skip
      }
    }

    if (!parsedRoundId) throw new Error("SpinPlaced event not found in receipt");
    roundId = parsedRoundId;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "On-chain error";
    console.error("roulette/spin on-chain error:", err);

    // Refund stake on failure
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).$transaction(async (tx: any) => {
        const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
        const bal = Number(wallet.balance);
        await tx.walletBalance.update({
          where: { userId },
          data:  { balance: String(bal + totalStake) },
        });
        await tx.ledgerEntry.create({
          data: {
            userId,
            type:          LedgerEntryType.BET_REFUND,
            amount:        String(totalStake),
            balanceBefore: String(bal),
            balanceAfter:  String(bal + totalStake),
            reference:     `refund:${betId}`,
          },
        });
        await debitHouseTx(tx, totalStake, HouseLedgerType.BET_REFUND, `refund:${betId}`);
        await tx.gameBet.update({
          where: { id: betId },
          data:  { status: "REFUNDED", settledAt: new Date() },
        });
      });
    } catch (refundErr) {
      console.error("roulette/spin CRITICAL: refund failed after on-chain error:", refundErr);
    }

    const friendlyMsg = errMsg.includes("stake out of range")
      ? "Stake is outside the allowed range (1–100,000 GZO per wager)."
      : errMsg.includes("invalid wager count")
      ? "Place between 1 and 15 wagers."
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
        resultJson: { wagers, placedTxHash: txHash },
      },
    });
  } catch (err) {
    console.error("roulette/spin: failed to update GameBet with roundId:", err);
  }

  return NextResponse.json({
    ok:         true,
    betId,
    roundId,
    txHash,
    totalStake,
    wagers,
    totalStakeEth: formatEther(parseEther(String(totalStake))),
  });
}
