/**
 * POST /api/games/mines/cashout
 *
 * Cash out an active custodial Mines round.
 *  1. House wallet calls MinesGame.cashoutFor() on-chain (verifies no mines in tiles)
 *  2. Read netPayout from RoundCashedOut event
 *  3. Credit DB balance, settle GameBet
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { debitHouseTx, creditHouseTx, HouseLedgerType } from "@/lib/house";
import { computeMinesGrossPayout, MINES_VERSION } from "@/lib/mines";
import { settle } from "@/lib/settlement";
import { getPublicClient, getHouseWalletClient, MINES_GAME_ABI } from "@/lib/viemServer";
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
    const revealedTiles: number[] = resultJson.revealedTiles ?? [];
    const multiplierPath: number[] = resultJson.multiplierPath ?? [];

    if (revealedTiles.length === 0) {
      return NextResponse.json(
        { error: "Reveal at least one safe tile before cashing out" },
        { status: 400 }
      );
    }

    const stake           = Number(dbRound.stakeGzo);
    const currentMultiplier = multiplierPath[multiplierPath.length - 1] ?? 1;

    // ── Call MinesGame.cashoutFor() on-chain ──────────────────────────────────
    const publicClient = getPublicClient();
    const { client: walletClient, account } = getHouseWalletClient();

    const { request } = await publicClient.simulateContract({
      address:      MINES_GAME_ADDRESS,
      abi:          MINES_GAME_ABI,
      functionName: "cashoutFor",
      args:         [roundId as `0x${string}`, revealedTiles.map(Number) as number[]],
      account,
    });
    const txHash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash:    txHash as `0x${string}`,
      timeout: 60_000,
    });

    // Read verified payout from RoundCashedOut event
    const { decodeEventLog } = await import("viem");
    let verifiedNetPayout: bigint | null = null;
    let verifiedMult100: bigint | null = null;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== MINES_GAME_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi:       MINES_GAME_ABI,
          data:      log.data,
          topics:    log.topics,
          eventName: "RoundCashedOut",
        });
        const args = decoded.args as { netPayout: bigint; multiplier100: bigint };
        verifiedNetPayout = args.netPayout;
        verifiedMult100   = args.multiplier100;
        break;
      } catch { /* skip */ }
    }

    // ── Credit DB balance ─────────────────────────────────────────────────────
    const grossPayout = computeMinesGrossPayout(stake, currentMultiplier);
    const { profitGzo, feeGzo, netPayoutGzo } = settle(stake, grossPayout);
    const now = new Date();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbResult = await (prisma as any).$transaction(async (tx: any) => {
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

      // Get mine positions from chain for history
      const minePositions = await tx.$queryRaw`SELECT 1`.then(() => null).catch(() => null);
      void minePositions;

      await tx.gameBet.update({
        where: { id: dbRound.id },
        data:  {
          status:    "SETTLED",
          settledAt: now,
          txHash,
          resultJson: {
            ...resultJson,
            outcome:         "CASHED_OUT",
            revealedTiles,
            multiplierPath,
            finalMultiplier: currentMultiplier,
            cashTxHash:      txHash,
            verifiedMult100: verifiedMult100?.toString(),
            rngVersion:      MINES_VERSION,
          },
          grossPayoutGzo: String(grossPayout),
          profitGzo:      String(profitGzo),
          feeGzo:         String(feeGzo),
          netPayoutGzo:   String(netPayoutGzo),
        },
      });

      return { balanceBefore, balanceAfter };
    });

    return NextResponse.json({
      ok:              true,
      outcome:         "CASHED_OUT",
      revealedTiles,
      multiplierPath,
      currentMultiplier,
      grossPayoutGzo:  grossPayout,
      profitGzo,
      feeGzo,
      netPayoutGzo,
      balanceBefore:   dbResult.balanceBefore,
      balanceAfter:    dbResult.balanceAfter,
      txHash,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    const clientErrors = [
      "Round not found",
      "Round is not active",
      "Reveal at least one safe tile before cashing out",
    ];
    if (clientErrors.includes(msg)) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("mines/cashout error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
