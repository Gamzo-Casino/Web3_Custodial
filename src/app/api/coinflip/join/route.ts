import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import {
  computeOutcome,
  computePublicSeed,
  computePayout,
} from "@/lib/coinflip";
import {
  creditHouseTx,
  debitHouseTx,
  HouseLedgerType,
} from "@/lib/house";
import { getClientSeedTx, rotateSeedTx, incrementNonceTx } from "@/lib/seedManager";
import { z } from "zod";

const bodySchema = z.object({
  matchId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const playerBId = session.user.id;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { matchId } = body;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (prisma as any).$transaction(async (tx: any) => {
      // ── 1. Concurrency guard: re-read match inside transaction ──────────────
      const match = await tx.coinflipMatch.findUnique({ where: { id: matchId } });
      if (!match) throw new Error("Match not found");
      if (match.status !== "PENDING") throw new Error("Match is no longer open");
      if (match.playerAId === playerBId) throw new Error("Cannot join your own match");

      // Idempotency guard: reject if GameBet for playerB already exists
      const existingBetB = await tx.gameBet.findUnique({
        where: { idempotencyKey: `${matchId}:${playerBId}` },
      });
      if (existingBetB) throw new Error("Match is no longer open");

      const stake = Number(match.wager);

      // ── 2. Debit player B's GZO wallet ─────────────────────────────────────
      const walletB = await tx.walletBalance.findUniqueOrThrow({ where: { userId: playerBId } });
      const beforeB = Number(walletB.balance);
      if (beforeB < stake) throw new Error("Insufficient balance");
      const afterB = beforeB - stake;

      await tx.walletBalance.update({
        where: { userId: playerBId },
        data: { balance: String(afterB) },
      });

      await tx.ledgerEntry.create({
        data: {
          userId: playerBId,
          type: LedgerEntryType.BET_PLACED,
          amount: String(stake),
          balanceBefore: String(beforeB),
          balanceAfter: String(afterB),
          reference: matchId,
        },
      });

      // ── 3. Credit house with player B's stake (escrow) ─────────────────────
      await creditHouseTx(tx, stake, HouseLedgerType.BET_IN, matchId);

      // ── 4. Get Player B's clientSeed from their PlayerSeedState ─────────────
      const clientSeed = await getClientSeedTx(tx, playerBId);

      // ── 5. Retrieve Player A's server seed & compute outcome ─────────────────
      const commitA = await tx.coinflipCommit.findUnique({
        where: { matchId_userId: { matchId, userId: match.playerAId } },
      });
      if (!commitA?.seed) throw new Error("Server seed missing — cannot resolve match");

      // Get the nonce that was snapshotted at match creation (from Player A's GameBet)
      const gameBetA = await tx.gameBet.findUnique({
        where: { idempotencyKey: `${matchId}:${match.playerAId}` },
      });
      const nonce = gameBetA?.nonce ?? 1;

      const publicSeed = computePublicSeed(matchId, playerBId);
      const outcome = computeOutcome(commitA.seed, clientSeed, publicSeed, nonce);
      const winnerId = outcome === match.playerAChoice ? match.playerAId : playerBId;
      const loserId = winnerId === match.playerAId ? playerBId : match.playerAId;

      // Settlement (10% fee on profit)
      const { grossPayoutGzo, profitGzo: winnerProfit, feeGzo, netPayoutGzo } = computePayout(stake);

      // ── 6. House pays gross pot, then recredits retained fee ────────────────
      await debitHouseTx(tx, grossPayoutGzo, HouseLedgerType.BET_OUT, matchId);
      await creditHouseTx(tx, feeGzo, HouseLedgerType.FEE, matchId);

      // ── 7. Credit winner's GZO wallet (net payout after fee) ───────────────
      const winnerWallet = await tx.walletBalance.findUniqueOrThrow({
        where: { userId: winnerId },
      });
      const beforeWinner = Number(winnerWallet.balance);
      const afterWinner = beforeWinner + netPayoutGzo;

      await tx.walletBalance.update({
        where: { userId: winnerId },
        data: { balance: String(afterWinner) },
      });

      await tx.ledgerEntry.create({
        data: {
          userId: winnerId,
          type: LedgerEntryType.BET_WON,
          amount: String(netPayoutGzo),
          balanceBefore: String(beforeWinner),
          balanceAfter: String(afterWinner),
          reference: matchId,
        },
      });

      // ── 8. Update match to COMPLETED ────────────────────────────────────────
      await tx.coinflipMatch.update({
        where: { id: matchId },
        data: {
          playerBId,
          outcome,
          winnerId,
          status: "COMPLETED",
          resolvedAt: new Date(),
        },
      });

      // ── 9. Rotate Player A's server seed (reveal old, commit new) ───────────
      //   This MUST happen after the outcome is computed and recorded.
      //   After rotation, the old serverSeed is safe to expose publicly.
      const { revealedSeed } = await rotateSeedTx(tx, match.playerAId);

      // ── 10. Reveal server seed in CoinflipCommit ────────────────────────────
      await tx.coinflipCommit.update({
        where: { matchId_userId: { matchId, userId: match.playerAId } },
        data: { revealedAt: new Date() },
      });

      // Store Player B's commit for audit trail
      await tx.coinflipCommit.create({
        data: {
          matchId,
          userId: playerBId,
          commitHash: clientSeed, // Player B's clientSeed is public (no pre-commitment)
          seed: clientSeed,
          revealedAt: new Date(),
        },
      });

      // ── 11. Increment nonces for both players ────────────────────────────────
      await incrementNonceTx(tx, match.playerAId);
      await incrementNonceTx(tx, playerBId);

      // ── 12. Settle GameBet for player A (PENDING → SETTLED) ─────────────────
      const now = new Date();
      const winnerIsA = winnerId === match.playerAId;

      await tx.gameBet.update({
        where: { idempotencyKey: `${matchId}:${match.playerAId}` },
        data: {
          status: "SETTLED",
          settledAt: now,
          serverSeedRevealed: revealedSeed,
          clientSeed,
          publicSeed,
          resultJson: { outcome, won: winnerIsA, opponentId: playerBId, rngVersion: 1 },
          grossPayoutGzo: winnerIsA ? String(grossPayoutGzo) : "0",
          profitGzo: winnerIsA ? String(winnerProfit) : String(-stake),
          feeGzo: winnerIsA ? String(feeGzo) : "0",
          netPayoutGzo: winnerIsA ? String(netPayoutGzo) : "0",
        },
      });

      // ── 13. Create & immediately settle GameBet for player B ────────────────
      const winnerIsB = winnerId === playerBId;

      // Get Player B's current nonce for their bet record (before increment above)
      const betBNonce = gameBetA?.nonce ?? 1; // same nonce context as the match

      await tx.gameBet.create({
        data: {
          userId: playerBId,
          gameType: "COINFLIP",
          stakeGzo: String(stake),
          status: "SETTLED",
          idempotencyKey: `${matchId}:${playerBId}`,
          referenceId: matchId,
          serverSeedHash: commitA.commitHash,
          serverSeedRevealed: revealedSeed,
          clientSeed,
          nonce: betBNonce,
          publicSeed,
          settledAt: now,
          resultJson: { outcome, won: winnerIsB, opponentId: match.playerAId, rngVersion: 1 },
          grossPayoutGzo: winnerIsB ? String(grossPayoutGzo) : "0",
          profitGzo: winnerIsB ? String(winnerProfit) : String(-stake),
          feeGzo: winnerIsB ? String(feeGzo) : "0",
          netPayoutGzo: winnerIsB ? String(netPayoutGzo) : "0",
        },
      });

      // ── 14. Audit log ────────────────────────────────────────────────────────
      await tx.auditLog.create({
        data: {
          userId: playerBId,
          action: "coinflip.settle",
          entity: "CoinflipMatch",
          entityId: matchId,
          metadata: {
            outcome,
            winnerId,
            loserId,
            grossPayoutGzo,
            feeGzo,
            netPayoutGzo,
            clientSeed,
            publicSeed,
            nonce,
            rngVersion: 1,
          },
        },
      });

      return {
        outcome,
        winnerId,
        grossPayoutGzo,
        feeGzo,
        netPayoutGzo,
        serverSeed: revealedSeed, // safe to return — seed is now rotated
        clientSeed,
        publicSeed,
        nonce,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    if (
      msg === "Match not found" ||
      msg === "Match is no longer open" ||
      msg === "Cannot join your own match" ||
      msg === "Insufficient balance" ||
      msg.startsWith("House treasury")
    ) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("coinflip/join error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
