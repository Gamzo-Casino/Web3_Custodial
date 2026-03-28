/**
 * GET /api/games/blackjack/status?roundId=0x...
 *
 * Polls the on-chain BlackjackGame for VRF settlement (deck seed generation).
 * Once the VRF is fulfilled (status=ACTIVE), derives the shuffled deck,
 * deals initial cards, and creates a BlackjackRound in the DB.
 *
 * Response while pending: { status: "pending_vrf" }
 * Response once active:   { status: "active", gameState: BlackjackGameState }
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { getPublicClient, BLACKJACK_GAME_ABI } from "@/lib/viemServer";
import { keccak256, encodePacked } from "viem";
import { buildGameState } from "@/lib/blackjack";

export const dynamic = "force-dynamic";

const BLACKJACK_GAME_ADDRESS = "0x370Af2cB87AFC8BDA70Daba1198c16e40C62CBC3" as const;

/** Mirror of the contract's Fisher-Yates _shuffleDeck(uint256 seed). */
function shuffleDeck(seed: bigint): number[] {
  const deck: number[] = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const hashHex = keccak256(
      encodePacked(["uint256", "uint8"], [seed, i])
    );
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

  const { userId } = authUser;
  const roundId = req.nextUrl.searchParams.get("roundId");
  if (!roundId || !/^0x[0-9a-fA-F]{64}$/.test(roundId)) {
    return NextResponse.json({ error: "Invalid roundId" }, { status: 400 });
  }

  // ── 1. Check if BlackjackRound already exists (idempotent) ────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingRound = await (prisma as any).blackjackRound.findFirst({
    where: { userId, serverSeedHash: roundId },
  });

  if (existingRound) {
    const wallet = await (prisma as any).walletBalance.findUnique({ where: { userId } });
    const balance = wallet ? Number(wallet.balance) : 0;
    return NextResponse.json({
      status:    existingRound.status === "SETTLED" ? "settled" : "active",
      gameState: buildGameState(existingRound, balance),
    });
  }

  // ── 2. Check the GameBet exists and belongs to this user ──────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gameBet = await (prisma as any).gameBet.findFirst({
    where: { onchainRoundId: roundId, userId },
  });
  if (!gameBet) {
    return NextResponse.json({ error: "Round not found" }, { status: 404 });
  }

  // ── 3. Read on-chain round ─────────────────────────────────────────────────
  let onChainRound: {
    player:       string;
    stake:        bigint;
    splitStake:   bigint;
    doubleStake:  bigint;
    deckSeed:     bigint;
    vrfRequestId: bigint;
    status:       number;
    netPayout:    bigint;
    createdAt:    bigint;
    settledAt:    bigint;
    custodial:    boolean;
  };

  try {
    const publicClient = getPublicClient();
    const result = await publicClient.readContract({
      address:      BLACKJACK_GAME_ADDRESS,
      abi:          BLACKJACK_GAME_ABI,
      functionName: "getRound",
      args:         [roundId as `0x${string}`],
    });
    onChainRound = result as typeof onChainRound;
  } catch (err) {
    console.error("blackjack/status: getRound error:", err);
    return NextResponse.json({ error: "Failed to read on-chain round" }, { status: 500 });
  }

  if (onChainRound.player === "0x0000000000000000000000000000000000000000") {
    return NextResponse.json({ status: "pending_vrf", reason: "round_not_found" });
  }

  // Status 0=PENDING, 1=ACTIVE, 2=SETTLED, 3=REFUNDED
  if (onChainRound.status === 0) {
    return NextResponse.json({ status: "pending_vrf" });
  }

  if (onChainRound.status >= 2) {
    return NextResponse.json({ error: "Round already settled or refunded on-chain" }, { status: 400 });
  }

  // ── 4. VRF fulfilled — derive deck and deal initial cards ──────────────────
  const deckSeed = onChainRound.deckSeed;
  const deck = shuffleDeck(deckSeed);

  // Deal order: player[0], dealer[0], player[1], dealer[1]
  const playerCardValues = [deck[0], deck[2]];
  const dealerCardValues = [deck[1], deck[3]];

  const stake = Number(gameBet.stakeGzo);
  const now = new Date();
  const idempotencyKey = `blackjack-chain:${userId}:${roundId}`;

  // ── 5. Create BlackjackRound in DB ─────────────────────────────────────────
  let newRound: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    newRound = await (prisma as any).blackjackRound.create({
      data: {
        userId,
        stakeGzo:      String(stake),
        deckJson:      JSON.stringify(deck),
        deckIndex:     4,
        playerCards:   JSON.stringify(playerCardValues),
        dealerCards:   JSON.stringify(dealerCardValues),
        activeHand:    0,
        mainStakeGzo:  String(stake),
        actions:       JSON.stringify([{ action: "deal", timestamp: now.toISOString() }]),
        status:        "ACTIVE",
        // Repurpose seed fields for VRF-based transparency
        serverSeed:    deckSeed.toString(),        // VRF seed (revealed immediately on ACTIVE)
        serverSeedHash: roundId,                   // on-chain roundId (commitment)
        clientSeed:    "vrf",
        nonce:         0,
        publicSeed:    `blackjack:${userId}`,
        rngVersion:    2,
        idempotencyKey,
        createdAt:     now,
      },
    });
  } catch (err: unknown) {
    // Unique constraint: already created in a race, fetch it
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("Unique constraint")) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing2 = await (prisma as any).blackjackRound.findFirst({
        where: { userId, serverSeedHash: roundId },
      });
      if (existing2) {
        const wallet = await (prisma as any).walletBalance.findUnique({ where: { userId } });
        const balance = wallet ? Number(wallet.balance) : 0;
        return NextResponse.json({
          status:    "active",
          gameState: buildGameState(existing2, balance),
        });
      }
    }
    console.error("blackjack/status: create BlackjackRound error:", err);
    return NextResponse.json({ error: "Failed to create game round" }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wallet = await (prisma as any).walletBalance.findUnique({ where: { userId } });
  const balance = wallet ? Number(wallet.balance) : 0;

  return NextResponse.json({
    status:    "active",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gameState: buildGameState(newRound as any, balance),
  });
}
