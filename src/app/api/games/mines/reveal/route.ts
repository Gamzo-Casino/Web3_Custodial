/**
 * POST /api/games/mines/reveal
 *
 * Reveal a single tile in an active custodial Mines round.
 *
 * - Safe tile: update DB, return new multiplier, game continues
 * - Mine tile: call MinesGame.loseRoundFor() on-chain, settle DB (no payout)
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { debitHouseTx, creditHouseTx, HouseLedgerType } from "@/lib/house";
import { computeMinesMultiplier, computeMinesGrossPayout, MINES_VERSION } from "@/lib/mines";
import { settle } from "@/lib/settlement";
import { getPublicClient, getHouseWalletClient, MINES_GAME_ABI } from "@/lib/viemServer";
import { z } from "zod";

const MINES_GAME_ADDRESS = "0x55d8093C2e75E682f6183EC78e4D35641010046f" as const;
const BOARD_SIZE = 25;

const bodySchema = z.object({
  roundId:       z.string().min(1),
  tileIndex:     z.number().int().min(0).max(24),
  minePositions: z.array(z.number().int().min(0).max(24)), // client provides; server verifies on-chain
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

  const { roundId, tileIndex } = body;

  try {
    // ── Fetch active DB round ─────────────────────────────────────────────────
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
    const mineCount: number      = resultJson.mineCount;
    const revealedTiles: number[] = resultJson.revealedTiles ?? [];
    const multiplierPath: number[] = resultJson.multiplierPath ?? [];
    const stake = Number(dbRound.stakeGzo);

    if (revealedTiles.includes(tileIndex)) {
      return NextResponse.json({ error: "Tile already revealed" }, { status: 400 });
    }

    // ── Read authoritative mine positions from on-chain ───────────────────────
    const publicClient = getPublicClient();
    const onChainPositions = await publicClient.readContract({
      address:      MINES_GAME_ADDRESS,
      abi:          MINES_GAME_ABI,
      functionName: "getMinePositions",
      args:         [roundId as `0x${string}`],
    }) as readonly number[];

    const minePositions = Array.from(onChainPositions).map(Number);
    const isMine = minePositions.includes(tileIndex);

    if (isMine) {
      // ── LOSS: call loseRoundFor() on-chain ────────────────────────────────
      const { client: walletClient, account } = getHouseWalletClient();

      const { request } = await publicClient.simulateContract({
        address:      MINES_GAME_ADDRESS,
        abi:          MINES_GAME_ABI,
        functionName: "loseRoundFor",
        args:         [roundId as `0x${string}`, tileIndex],
        account,
      });
      const loseTxHash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({
        hash:    loseTxHash as `0x${string}`,
        timeout: 60_000,
      });

      // Settle DB — house keeps stake (already debited at start)
      const newRevealed = [...revealedTiles, tileIndex];
      const now = new Date();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).$transaction(async (tx: any) => {
        await tx.gameBet.update({
          where: { id: dbRound.id },
          data:  {
            status:    "SETTLED",
            settledAt: now,
            resultJson: {
              ...resultJson,
              outcome:       "LOST",
              minePositions,
              revealedTiles: newRevealed,
              hitMine:       tileIndex,
              multiplierPath,
              loseTxHash,
              rngVersion:    MINES_VERSION,
            },
            grossPayoutGzo: "0",
            profitGzo:      String(-stake),
            feeGzo:         "0",
            netPayoutGzo:   "0",
          },
        });

        await tx.auditLog.create({
          data: {
            userId,
            action:   "mines.lose",
            entity:   "GameBet",
            entityId: dbRound.id,
            metadata: { tileIndex, stake, safePicks: revealedTiles.length },
          },
        });
      });

      return NextResponse.json({
        ok:             true,
        outcome:        "LOST",
        tileIndex,
        isMine:         true,
        minePositions,
        revealedTiles:  newRevealed,
        multiplierPath,
        currentMultiplier: 0,
        netPayoutGzo:   0,
        loseTxHash,
      });
    }

    // ── SAFE TILE: update DB only (no on-chain call needed) ───────────────────
    const newRevealed = [...revealedTiles, tileIndex];
    const safePicks   = newRevealed.length;
    const newMult     = computeMinesMultiplier(BOARD_SIZE, mineCount, safePicks);
    const newMultPath = [...multiplierPath, newMult];
    const totalSafe   = BOARD_SIZE - mineCount;
    const allSafe     = safePicks >= totalSafe;

    if (allSafe) {
      // ── Auto-cashout: all safe tiles found (call cashoutFor on-chain) ──────
      const { client: walletClient, account } = getHouseWalletClient();

      const { request } = await publicClient.simulateContract({
        address:      MINES_GAME_ADDRESS,
        abi:          MINES_GAME_ABI,
        functionName: "cashoutFor",
        args:         [roundId as `0x${string}`, newRevealed.map(Number) as number[]],
        account,
      });
      const cashTxHash = await walletClient.writeContract(request);
      const cashReceipt = await publicClient.waitForTransactionReceipt({
        hash:    cashTxHash as `0x${string}`,
        timeout: 60_000,
      });

      // Read netPayout from RoundCashedOut event
      const { decodeEventLog } = await import("viem");
      let netPayoutWei = BigInt(0);
      for (const log of cashReceipt.logs) {
        if (log.address.toLowerCase() !== MINES_GAME_ADDRESS.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi:       MINES_GAME_ABI,
            data:      log.data,
            topics:    log.topics,
            eventName: "RoundCashedOut",
          });
          netPayoutWei = (decoded.args as { netPayout: bigint }).netPayout;
          break;
        } catch { /* skip */ }
      }

      const grossPayout = computeMinesGrossPayout(stake, newMult);
      const { profitGzo, feeGzo, netPayoutGzo } = settle(stake, grossPayout);
      const now = new Date();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).$transaction(async (tx: any) => {
        const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
        const balanceBefore = Number(wallet.balance);
        const balanceAfter  = balanceBefore + netPayoutGzo;

        await tx.walletBalance.update({
          where: { userId },
          data:  { balance: String(balanceAfter) },
        });
        await tx.ledgerEntry.create({
          data: {
            userId,
            type:          LedgerEntryType.BET_WON,
            amount:        String(netPayoutGzo),
            balanceBefore: String(balanceBefore),
            balanceAfter:  String(balanceAfter),
            reference:     dbRound.id,
          },
        });

        await debitHouseTx(tx, grossPayout, HouseLedgerType.BET_OUT, dbRound.id);
        if (feeGzo > 0) await creditHouseTx(tx, feeGzo, HouseLedgerType.FEE, dbRound.id);

        await tx.gameBet.update({
          where: { id: dbRound.id },
          data:  {
            status:    "SETTLED",
            settledAt: now,
            resultJson: {
              ...resultJson,
              outcome:        "CASHED_OUT",
              minePositions,
              revealedTiles:  newRevealed,
              multiplierPath: newMultPath,
              finalMultiplier: newMult,
              cashTxHash,
              rngVersion:     MINES_VERSION,
            },
            grossPayoutGzo: String(grossPayout),
            profitGzo:      String(profitGzo),
            feeGzo:         String(feeGzo),
            netPayoutGzo:   String(netPayoutGzo),
          },
        });
      });

      return NextResponse.json({
        ok:              true,
        outcome:         "CASHED_OUT",
        tileIndex,
        isMine:          false,
        minePositions,
        revealedTiles:   newRevealed,
        multiplierPath:  newMultPath,
        currentMultiplier: newMult,
        grossPayoutGzo:  grossPayout,
        profitGzo,
        feeGzo,
        netPayoutGzo,
        cashTxHash,
        netPayoutWei:    netPayoutWei.toString(),
      });
    }

    // ── Normal safe reveal — update DB, return new state ─────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).gameBet.update({
      where: { id: dbRound.id },
      data:  {
        resultJson: {
          ...resultJson,
          revealedTiles:  newRevealed,
          multiplierPath: newMultPath,
        },
      },
    });

    return NextResponse.json({
      ok:              true,
      outcome:         "SAFE",
      tileIndex,
      isMine:          false,
      minePositions:   null,
      revealedTiles:   newRevealed,
      multiplierPath:  newMultPath,
      currentMultiplier: newMult,
      grossPayoutGzo:  computeMinesGrossPayout(stake, newMult),
      profitGzo:       null,
      feeGzo:          null,
      netPayoutGzo:    null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    const clientErrors = ["Round not found", "Round is not active", "Tile already revealed"];
    if (clientErrors.includes(msg)) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("mines/reveal error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
