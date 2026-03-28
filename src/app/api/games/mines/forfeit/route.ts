/**
 * POST /api/games/mines/forfeit
 *
 * Forfeit an active custodial Mines round.
 * Player loses the stake. House wallet calls loseRoundFor() using the first mine position.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { getPublicClient, getHouseWalletClient, MINES_GAME_ABI } from "@/lib/viemServer";
import { MINES_VERSION } from "@/lib/mines";
import { z } from "zod";

const MINES_GAME_ADDRESS = "0x55d8093C2e75E682f6183EC78e4D35641010046f" as const;

const bodySchema = z.object({
  roundId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authUser.userId;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { roundId } = body;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbRound = await (prisma as any).gameBet.findFirst({
      where: { userId, gameType: "MINES", onchainRoundId: roundId },
    });
    if (!dbRound) {
      return NextResponse.json({ error: "Round not found" }, { status: 404 });
    }
    if (dbRound.status !== "PENDING") {
      return NextResponse.json({ error: "Round is not active" }, { status: 400 });
    }

    const resultJson = dbRound.resultJson as {
      mineCount: number;
      revealedTiles?: number[];
      multiplierPath?: number[];
    };
    const revealedTiles: number[] = resultJson.revealedTiles ?? [];
    const multiplierPath: number[] = resultJson.multiplierPath ?? [];
    const stake = Number(dbRound.stakeGzo);
    const now = new Date();

    // ── Get mine positions from on-chain, call loseRoundFor ───────────────────
    const publicClient = getPublicClient();

    // Verify VRF has fulfilled (round must be ACTIVE to call loseRoundFor)
    const onChainRound = await publicClient.readContract({
      address:      MINES_GAME_ADDRESS,
      abi:          MINES_GAME_ABI,
      functionName: "getRound",
      args:         [roundId as `0x${string}`],
    }) as { status: number };

    if (Number(onChainRound.status) !== 1 /* ACTIVE */) {
      // VRF not fulfilled yet — just mark DB as refunded (VRF timeout path)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).gameBet.update({
        where: { id: dbRound.id },
        data:  {
          status:    "SETTLED",
          settledAt: now,
          resultJson: { ...resultJson, outcome: "FORFEITED_PENDING", rngVersion: MINES_VERSION },
          grossPayoutGzo: "0",
          profitGzo:      String(-stake),
          feeGzo:         "0",
          netPayoutGzo:   "0",
        },
      });
      return NextResponse.json({ ok: true, forfeited: true, roundId });
    }

    // Get first mine position to call loseRoundFor
    const positions = await publicClient.readContract({
      address:      MINES_GAME_ADDRESS,
      abi:          MINES_GAME_ABI,
      functionName: "getMinePositions",
      args:         [roundId as `0x${string}`],
    }) as readonly number[];

    const minePositions = Array.from(positions).map(Number);
    const hitTile = minePositions[0]; // use first mine to settle on-chain

    const { client: walletClient, account } = getHouseWalletClient();
    const { request } = await publicClient.simulateContract({
      address:      MINES_GAME_ADDRESS,
      abi:          MINES_GAME_ABI,
      functionName: "loseRoundFor",
      args:         [roundId as `0x${string}`, hitTile],
      account,
    });
    const txHash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({
      hash:    txHash as `0x${string}`,
      timeout: 60_000,
    });

    // ── Settle DB ─────────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).gameBet.update({
      where: { id: dbRound.id },
      data:  {
        status:    "SETTLED",
        settledAt: now,
        txHash,
        resultJson: {
          ...resultJson,
          outcome:       "FORFEITED",
          minePositions,
          revealedTiles,
          multiplierPath,
          rngVersion:    MINES_VERSION,
        },
        grossPayoutGzo: "0",
        profitGzo:      String(-stake),
        feeGzo:         "0",
        netPayoutGzo:   "0",
      },
    });

    await (prisma as any).auditLog.create({
      data: {
        userId,
        action:   "mines.forfeit",
        entity:   "GameBet",
        entityId: dbRound.id,
        metadata: { stake, safePicks: revealedTiles.length, txHash },
      },
    }).catch(() => {/* non-critical */});

    return NextResponse.json({ ok: true, forfeited: true, roundId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    if (["Round not found", "Round is not active"].includes(msg)) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("mines/forfeit error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
