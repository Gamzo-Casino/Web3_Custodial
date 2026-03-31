/**
 * POST /api/games/hilo/abandon
 *
 * Self-service recovery for stuck HiLo rounds.
 * Reads on-chain state via getRound() and reconciles the DB:
 *
 *  On-chain CASHED_OUT → credit netPayout to DB balance, mark round CASHED_OUT
 *  On-chain LOST       → mark round LOST (no credit — stake already taken)
 *  On-chain PENDING    → if round >10 min old, refund stake
 *  On-chain ACTIVE     → if round >15 min old, refund stake (shouldn't happen)
 *  On-chain read fails → if round >15 min old, refund stake as fallback
 *
 * Also handles PENDING GameBets (VRF never fulfilled):
 *  if older than 10 min, refund stake and mark REFUNDED
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { getPublicClient, HILO_GAME_ABI } from "@/lib/viemServer";
import { formatEther } from "viem";

export const dynamic = "force-dynamic";

const HILO_GAME_ADDRESS = "0x8572650a140f27F481aFA0359877cEE99d08d241" as `0x${string}`;
const STALE_MS = 10 * 60 * 1000; // 10 minutes

// On-chain status enum: 0=PENDING,1=ACTIVE,2=CASHED_OUT,3=LOST,4=REFUNDED
const ONCHAIN_STATUS: Record<number, string> = {
  0: "PENDING",
  1: "ACTIVE",
  2: "CASHED_OUT",
  3: "LOST",
  4: "REFUNDED",
};

async function creditAndClose(
  tx: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  userId: string,
  roundId: string,
  status: "CASHED_OUT" | "LOST" | "REFUNDED",
  creditGzo: number,
  entryType: typeof LedgerEntryType[keyof typeof LedgerEntryType],
  resultExtra: Record<string, unknown> = {}
) {
  if (creditGzo > 0) {
    const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
    const balBefore = Number(wallet.balance);
    const balAfter = balBefore + creditGzo;
    await tx.walletBalance.update({ where: { userId }, data: { balance: String(balAfter) } });
    await tx.ledgerEntry.create({
      data: {
        userId,
        type:          entryType,
        amount:        String(creditGzo),
        balanceBefore: String(balBefore),
        balanceAfter:  String(balAfter),
        reference:     roundId,
      },
    });
  }

  await tx.hiloRound.update({
    where: { id: roundId },
    data: {
      status,
      settledAt: new Date(),
      resultJson: {
        ...resultExtra,
        recoveredAt: new Date().toISOString(),
        recoveryMethod: "abandon",
      },
    },
  });
}

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authUser.userId;

  // ── 1. Find the stuck round ─────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const round = await (prisma as any).hiloRound.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });

  // Also check for PENDING GameBet (VRF never fulfilled)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingBet = round ? null : await (prisma as any).gameBet.findFirst({
    where: { userId, gameType: "HILO", status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });

  if (!round && !pendingBet) {
    return NextResponse.json({ error: "No stuck round found" }, { status: 404 });
  }

  // ── 2. Handle PENDING GameBet (VRF never fulfilled) ─────────────────────────
  if (pendingBet) {
    const ageMs = Date.now() - new Date(pendingBet.createdAt).getTime();
    if (ageMs < STALE_MS) {
      const waitSec = Math.ceil((STALE_MS - ageMs) / 1000);
      return NextResponse.json({
        error: `VRF is still in progress. Please wait ${waitSec} more seconds before recovering.`,
      }, { status: 400 });
    }

    const stakeGzo = Number(pendingBet.stakeGzo);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).$transaction(async (tx: any) => {
        const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
        const balBefore = Number(wallet.balance);
        const balAfter = balBefore + stakeGzo;
        await tx.walletBalance.update({ where: { userId }, data: { balance: String(balAfter) } });
        await tx.ledgerEntry.create({
          data: {
            userId,
            type:          LedgerEntryType.BET_REFUND,
            amount:        String(stakeGzo),
            balanceBefore: String(balBefore),
            balanceAfter:  String(balAfter),
            reference:     `vrf-refund:${pendingBet.id}`,
          },
        });
        await tx.gameBet.update({
          where: { id: pendingBet.id },
          data: {
            status:    "REFUNDED",
            settledAt: new Date(),
            resultJson: { refundReason: "vrf_timeout_self_service", recoveredAt: new Date().toISOString() },
          },
        });
      });

      return NextResponse.json({
        ok: true,
        action: "REFUNDED",
        refundedGzo: stakeGzo,
        message: `${stakeGzo} GZO refunded — VRF request timed out.`,
      });
    } catch (err) {
      console.error("hilo/abandon pendingBet refund error:", err);
      return NextResponse.json({ error: "Refund failed, please contact support" }, { status: 500 });
    }
  }

  // ── 3. Active HiloRound — check on-chain status ──────────────────────────────
  const onchainRoundId = round.serverSeedHash as string;
  const stakeGzo = Number(round.stakeGzo);
  const ageMs = Date.now() - new Date(round.createdAt).getTime();

  let onchainStatus: number | null = null;
  let onchainNetPayout: bigint = 0n;

  if (onchainRoundId && /^0x[0-9a-fA-F]{64}$/.test(onchainRoundId)) {
    try {
      const client = getPublicClient();
      const result = await client.readContract({
        address:      HILO_GAME_ADDRESS,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        abi:          HILO_GAME_ABI as any,
        functionName: "getRound",
        args:         [onchainRoundId as `0x${string}`],
      }) as { status: number; netPayout: bigint };

      onchainStatus = Number(result.status);
      onchainNetPayout = result.netPayout ?? 0n;
    } catch (err) {
      console.warn("hilo/abandon getRound failed:", err);
    }
  }

  // ── 4. Reconcile based on on-chain status ────────────────────────────────────

  // CASHED_OUT on-chain — credit the net payout the contract already paid out
  if (onchainStatus === 2) {
    const netPayout = Math.floor(Number(formatEther(onchainNetPayout)));
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).$transaction(async (tx: any) => {
        await creditAndClose(tx, userId, round.id, "CASHED_OUT", netPayout, LedgerEntryType.BET_WON, {
          outcome: "CASHED_OUT",
          netPayoutGzo: netPayout,
          recoveredFrom: "onchain_cashed_out",
        });
      });

      return NextResponse.json({
        ok: true,
        action: "CASHED_OUT",
        creditedGzo: netPayout,
        message: `Round recovered — ${netPayout} GZO credited to your balance.`,
      });
    } catch (err) {
      console.error("hilo/abandon CASHED_OUT reconcile error:", err);
      return NextResponse.json({ error: "Recovery failed, please contact support" }, { status: 500 });
    }
  }

  // LOST on-chain — just mark the DB round as lost (stake already deducted)
  if (onchainStatus === 3) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).$transaction(async (tx: any) => {
        await creditAndClose(tx, userId, round.id, "LOST", 0, LedgerEntryType.BET_PLACED, {
          outcome: "LOST",
          recoveredFrom: "onchain_lost",
        });
      });

      return NextResponse.json({
        ok: true,
        action: "LOST",
        creditedGzo: 0,
        message: "Round closed — the round was already lost on-chain.",
      });
    } catch (err) {
      console.error("hilo/abandon LOST reconcile error:", err);
      return NextResponse.json({ error: "Recovery failed, please contact support" }, { status: 500 });
    }
  }

  // REFUNDED on-chain already
  if (onchainStatus === 4) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).$transaction(async (tx: any) => {
        await creditAndClose(tx, userId, round.id, "REFUNDED", stakeGzo, LedgerEntryType.BET_REFUND, {
          outcome: "REFUNDED",
          recoveredFrom: "onchain_refunded",
        });
      });

      return NextResponse.json({
        ok: true,
        action: "REFUNDED",
        refundedGzo: stakeGzo,
        message: `${stakeGzo} GZO refunded — round was already refunded on-chain.`,
      });
    } catch (err) {
      console.error("hilo/abandon REFUNDED reconcile error:", err);
      return NextResponse.json({ error: "Recovery failed, please contact support" }, { status: 500 });
    }
  }

  // On-chain PENDING or ACTIVE (VRF not yet fulfilled) — only refund if stale
  if (onchainStatus === 0 || onchainStatus === 1) {
    if (ageMs < STALE_MS) {
      const waitSec = Math.ceil((STALE_MS - ageMs) / 1000);
      return NextResponse.json({
        error: `VRF is still in progress. Please wait ${waitSec} more seconds before recovering.`,
      }, { status: 400 });
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).$transaction(async (tx: any) => {
        await creditAndClose(tx, userId, round.id, "REFUNDED", stakeGzo, LedgerEntryType.BET_REFUND, {
          outcome: "REFUNDED",
          recoveredFrom: "onchain_vrf_pending_timeout",
        });
      });

      return NextResponse.json({
        ok: true,
        action: "REFUNDED",
        refundedGzo: stakeGzo,
        message: `${stakeGzo} GZO refunded — VRF request timed out.`,
      });
    } catch (err) {
      console.error("hilo/abandon VRF timeout refund error:", err);
      return NextResponse.json({ error: "Refund failed, please contact support" }, { status: 500 });
    }
  }

  // On-chain read failed — fallback: refund if old enough
  if (onchainStatus === null) {
    const FALLBACK_STALE_MS = 15 * 60 * 1000;
    if (ageMs < FALLBACK_STALE_MS) {
      const waitSec = Math.ceil((FALLBACK_STALE_MS - ageMs) / 1000);
      return NextResponse.json({
        error: `Could not read on-chain state. Please wait ${waitSec} more seconds then try again.`,
      }, { status: 400 });
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).$transaction(async (tx: any) => {
        await creditAndClose(tx, userId, round.id, "REFUNDED", stakeGzo, LedgerEntryType.BET_REFUND, {
          outcome: "REFUNDED",
          recoveredFrom: "fallback_onchain_read_failed",
        });
      });

      return NextResponse.json({
        ok: true,
        action: "REFUNDED",
        refundedGzo: stakeGzo,
        message: `${stakeGzo} GZO refunded — round timed out.`,
      });
    } catch (err) {
      console.error("hilo/abandon fallback refund error:", err);
      return NextResponse.json({ error: "Refund failed, please contact support" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unable to recover round — unknown state" }, { status: 500 });
}
