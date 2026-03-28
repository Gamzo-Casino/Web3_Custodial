/**
 * GET /api/games/hilo/status?roundId=0x...
 *
 * Polls on-chain status for a VRF round.
 * 1. If HiloRound already exists in DB (idempotent), return it immediately.
 * 2. Read getRound() on-chain — if PENDING, return { status: "pending_vrf" }
 * 3. If ACTIVE: mirror shuffleDeck(deckSeed) to get card order,
 *    create HiloRound in DB, return { status: "active", gameState }
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { getPublicClient, HILO_GAME_ABI } from "@/lib/viemServer";
import { keccak256, encodePacked } from "viem";
import { buildHiloState } from "@/lib/hilo";

export const dynamic = "force-dynamic";

const HILO_GAME_ADDRESS = "0x8572650a140f27F481aFA0359877cEE99d08d241" as const;

/** Mirror of HiloGame._shuffleDeck(seed): Fisher-Yates via keccak256 */
function shuffleDeck(seed: bigint): number[] {
  const deck: number[] = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const hashHex = keccak256(encodePacked(["uint256", "uint8"], [seed, i]));
    const j = Number(BigInt(hashHex) % BigInt(i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authUser.userId;

  const roundId = req.nextUrl.searchParams.get("roundId");
  if (!roundId || !/^0x[0-9a-fA-F]{64}$/.test(roundId)) {
    return NextResponse.json({ error: "Invalid roundId" }, { status: 400 });
  }

  // ── Idempotency: return existing HiloRound if already created ─────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingRound = await (prisma as any).hiloRound.findFirst({
    where: { serverSeedHash: roundId, userId },
  });
  if (existingRound) {
    return NextResponse.json({ status: "active", gameState: buildHiloState(existingRound) });
  }

  // ── Poll on-chain ──────────────────────────────────────────────────────────
  try {
    const publicClient = getPublicClient();

    const onchainRound = await publicClient.readContract({
      address:      HILO_GAME_ADDRESS,
      abi:          HILO_GAME_ABI,
      functionName: "getRound",
      args:         [roundId as `0x${string}`],
    }) as { player: string; stake: bigint; deckSeed: bigint; status: number; custodial: boolean };

    // status 0 = PENDING (VRF not yet fulfilled)
    if (onchainRound.status === 0) {
      return NextResponse.json({ status: "pending_vrf" });
    }

    // status 1 = ACTIVE — VRF fulfilled, deckSeed available
    if (onchainRound.status !== 1) {
      return NextResponse.json({ status: "pending_vrf" });
    }

    const deckSeed = onchainRound.deckSeed;
    const deck = shuffleDeck(deckSeed);

    // Find the GameBet for this onchainRoundId to get stake/userId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gameBet = await (prisma as any).gameBet.findFirst({
      where: { onchainRoundId: roundId, userId },
    });
    if (!gameBet) {
      return NextResponse.json({ error: "GameBet not found for this round" }, { status: 400 });
    }

    // ── Create HiloRound in DB ───────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const round = await (prisma as any).$transaction(async (tx: any) => {
      // Double-check idempotency inside transaction
      const existing = await tx.hiloRound.findFirst({
        where: { serverSeedHash: roundId, userId },
      });
      if (existing) return existing;

      return tx.hiloRound.create({
        data: {
          userId,
          stakeGzo:          gameBet.stakeGzo,
          deckJson:          JSON.stringify(deck),
          deckIndex:         1,          // deck[0] is starting card, next draw from deck[1]
          currentMultiplier: "1",
          guessHistory:      "[]",
          status:            "ACTIVE",
          serverSeed:        deckSeed.toString(), // VRF seed stored as serverSeed
          serverSeedHash:    roundId,             // on-chain roundId stored here
          clientSeed:        "vrf",
          nonce:             0,
          publicSeed:        `hilo:${userId}`,
          rngVersion:        2,
          idempotencyKey:    `hilo:vrf:${roundId}`,
        },
      });
    });

    return NextResponse.json({ status: "active", gameState: buildHiloState(round) });
  } catch (err) {
    console.error("hilo/status error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
