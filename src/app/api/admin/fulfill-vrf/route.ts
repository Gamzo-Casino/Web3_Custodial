/**
 * POST /api/admin/fulfill-vrf
 *
 * Manually fulfills stuck VRF requests when Chainlink's Amoy node is delayed.
 * Reads pending GameBets from DB, finds their on-chain VRF request IDs via
 * RandomnessRequested events, then calls RandomnessCoordinator.manualFulfill()
 * with a cryptographically secure random word.
 *
 * Auth: Bearer AUTH_SECRET header
 *
 * Body: { betIds?: string[], olderThanMinutes?: number (default 5), dryRun?: boolean }
 *   - betIds: specific bet IDs to fulfill (skips age check)
 *   - olderThanMinutes: fulfill all PENDING bets older than this
 *   - dryRun: if true, only returns what would be fulfilled (no on-chain tx)
 *
 * GET /api/admin/fulfill-vrf — lists all pending VRF bets with their VRF request IDs
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPublicClient, getHouseWalletClient } from "@/lib/viemServer";
import { parseAbi, decodeEventLog, hexToBigInt } from "viem";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

const RC_PROXY = "0x5A8b5C504743b7cd4A26adED19B77bA5B0421B67" as const;

const RC_ABI = parseAbi([
  "event RandomnessRequested(uint256 indexed vrfRequestId, bytes32 indexed gameId, bytes32 indexed roundId)",
  "function manualFulfill(uint256 vrfRequestId, uint256 randomWord) external",
  "function requests(uint256 vrfRequestId) view returns (bytes32 gameId, address gameContract, bytes32 roundId, bool fulfilled)",
]);

function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const secret = process.env.AUTH_SECRET ?? "";
  return token === secret && token.length >= 16;
}

/** Generate a cryptographically secure 256-bit random number as bigint */
function secureRandomWord(): bigint {
  const bytes = randomBytes(32);
  return hexToBigInt(`0x${bytes.toString("hex")}`);
}

/** Find VRF request ID from the bet-placement transaction receipt */
async function getVrfRequestIdFromTx(txHash: string): Promise<bigint | null> {
  const publicClient = getPublicClient();
  try {
    const receipt = await publicClient.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== RC_PROXY.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: RC_ABI,
          data: log.data,
          topics: log.topics,
          eventName: "RandomnessRequested",
        });
        return (decoded.args as { vrfRequestId: bigint }).vrfRequestId;
      } catch {
        // not this event, try next
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Find VRF request ID: try tx receipt first (fast), then fall back to event scan */
async function getVrfRequestId(roundId: string, txHash?: string | null): Promise<bigint | null> {
  // Fast path: parse directly from the placement tx receipt
  if (txHash) {
    const fromTx = await getVrfRequestIdFromTx(txHash);
    if (fromTx !== null) return fromTx;
  }

  // Slow path: scan recent blocks for the RandomnessRequested event
  const publicClient = getPublicClient();
  try {
    const latestBlock = await publicClient.getBlockNumber();
    // Scan in 2,000-block chunks (stays within most RPC limits)
    const chunkSize = 2_000n;
    const lookback  = 20_000n; // ~11 hours on Amoy
    const from      = latestBlock > lookback ? latestBlock - lookback : 0n;

    for (let start = from; start <= latestBlock; start += chunkSize) {
      const end = start + chunkSize - 1n < latestBlock ? start + chunkSize - 1n : latestBlock;
      try {
        const logs = await publicClient.getLogs({
          address: RC_PROXY,
          event: RC_ABI[0],
          args: { roundId: roundId as `0x${string}` },
          fromBlock: start,
          toBlock: end,
        });
        if (logs.length > 0) {
          return (logs[logs.length - 1].args as { vrfRequestId: bigint }).vrfRequestId;
        }
      } catch {
        // chunk failed — skip and try next
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/** Check if a VRF request is already fulfilled on-chain */
async function isVrfFulfilled(vrfRequestId: bigint): Promise<boolean> {
  const publicClient = getPublicClient();
  try {
    const req = await publicClient.readContract({
      address: RC_PROXY,
      abi: RC_ABI,
      functionName: "requests",
      args: [vrfRequestId],
    });
    // requests() returns tuple [gameId, gameContract, roundId, fulfilled]
    return (req as unknown as [string, string, string, boolean])[3];
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pendingBets = await (prisma as any).gameBet.findMany({
      where: { status: "PENDING", onchainRoundId: { not: null } },
      orderBy: { createdAt: "asc" },
    });

    const results = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pendingBets.map(async (bet: any) => {
        const vrfRequestId = await getVrfRequestId(bet.onchainRoundId, bet.txHash);
        const fulfilled = vrfRequestId ? await isVrfFulfilled(vrfRequestId) : null;
        return {
          betId: bet.id,
          userId: bet.userId,
          gameType: bet.gameType,
          stakeGzo: Number(bet.stakeGzo),
          onchainRoundId: bet.onchainRoundId,
          txHash: bet.txHash,
          createdAt: bet.createdAt,
          minutesAgo: Math.round((Date.now() - new Date(bet.createdAt).getTime()) / 60000),
          vrfRequestId: vrfRequestId?.toString() ?? null,
          vrfAlreadyFulfilled: fulfilled,
        };
      })
    );

    return NextResponse.json({ count: results.length, bets: results });
  } catch (err) {
    console.error("fulfill-vrf GET error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { betIds?: string[]; olderThanMinutes?: number; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const dryRun = body.dryRun ?? false;
  const olderThanMinutes = body.olderThanMinutes ?? 5;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bets: any[];
    if (body.betIds && body.betIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bets = await (prisma as any).gameBet.findMany({
        where: { id: { in: body.betIds }, status: "PENDING", onchainRoundId: { not: null } },
      });
    } else {
      const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bets = await (prisma as any).gameBet.findMany({
        where: { status: "PENDING", onchainRoundId: { not: null }, createdAt: { lt: cutoff } },
        orderBy: { createdAt: "asc" },
      });
    }

    if (bets.length === 0) {
      return NextResponse.json({ ok: true, fulfilled: 0, message: "No pending VRF bets found" });
    }

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, wouldFulfill: bets.length });
    }

    const { client: walletClient, account } = getHouseWalletClient();
    const publicClient = getPublicClient();

    const results = [];

    for (const bet of bets) {
      const vrfRequestId = await getVrfRequestId(bet.onchainRoundId, bet.txHash);
      if (!vrfRequestId) {
        results.push({ betId: bet.id, ok: false, error: "VRF request ID not found in events" });
        continue;
      }

      const alreadyFulfilled = await isVrfFulfilled(vrfRequestId);
      if (alreadyFulfilled) {
        results.push({ betId: bet.id, ok: false, error: "VRF already fulfilled on-chain (DB not updated yet — re-poll status)" });
        continue;
      }

      const randomWord = secureRandomWord();

      try {
        const txHash = await walletClient.writeContract({
          address: RC_PROXY,
          abi: RC_ABI,
          functionName: "manualFulfill",
          args: [vrfRequestId, randomWord],
          account,
          gas: 500_000n,
        });

        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
          timeout: 60_000,
        });

        if (receipt.status === "success") {
          results.push({
            betId: bet.id,
            gameType: bet.gameType,
            onchainRoundId: bet.onchainRoundId,
            vrfRequestId: vrfRequestId.toString(),
            randomWord: randomWord.toString(),
            txHash,
            ok: true,
          });
        } else {
          results.push({ betId: bet.id, ok: false, error: "Transaction reverted", txHash });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        results.push({ betId: bet.id, ok: false, error: msg.slice(0, 200) });
      }
    }

    const succeeded = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;

    return NextResponse.json({ ok: failed === 0, fulfilled: succeeded, failed, results });
  } catch (err) {
    console.error("fulfill-vrf POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
