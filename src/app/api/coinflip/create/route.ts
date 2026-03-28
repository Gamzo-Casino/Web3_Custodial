import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { hashServerSeed } from "@/lib/coinflip";
import {
  creditHouseTx,
  ensureHouseSolvencyTx,
  HouseLedgerType,
} from "@/lib/house";
import { getBetSeedsTx, incrementNonceTx } from "@/lib/seedManager";
import { z } from "zod";

const bodySchema = z.object({
  stake: z.number().int().min(1).max(100_000),
  side: z.enum(["HEADS", "TAILS"]),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { stake, side } = body;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (prisma as any).$transaction(async (tx: any) => {
      // ── 1. Check house treasury solvency ───────────────────────────────────
      await ensureHouseSolvencyTx(tx, stake);

      // ── 2. Get Player A's seed state (serverSeed from PlayerSeedState) ─────
      //   serverSeed is the HMAC key committed for this match.
      //   nonce = Player A's current nonce, snapshotted before incrementing.
      const seeds = await getBetSeedsTx(tx, userId);
      const { serverSeed, serverSeedHash, nonce } = seeds;
      const commitHash = hashServerSeed(serverSeed); // SHA-256(serverSeed)
      if (commitHash !== serverSeedHash) {
        throw new Error("Seed hash mismatch — internal error");
      }

      // ── 3. Debit player A's GZO wallet ─────────────────────────────────────
      const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
      const before = Number(wallet.balance);
      if (before < stake) throw new Error("Insufficient balance");
      const after = before - stake;

      await tx.walletBalance.update({
        where: { userId },
        data: { balance: String(after) },
      });

      await tx.ledgerEntry.create({
        data: {
          userId,
          type: LedgerEntryType.BET_PLACED,
          amount: String(stake),
          balanceBefore: String(before),
          balanceAfter: String(after),
          reference: null,
        },
      });

      // ── 4. Create match ─────────────────────────────────────────────────────
      const match = await tx.coinflipMatch.create({
        data: {
          playerAId: userId,
          wager: String(stake),
          playerAChoice: side,
          status: "PENDING",
        },
      });

      // ── 5. Credit house treasury (escrow) ───────────────────────────────────
      await creditHouseTx(tx, stake, HouseLedgerType.BET_IN, match.id);

      // ── 6. Commit: serverSeed stored server-side, only hash is public ───────
      await tx.coinflipCommit.create({
        data: {
          matchId: match.id,
          userId,
          commitHash,
          seed: serverSeed, // secret — never returned via API until revealedAt is set
        },
      });

      // ── 7. Increment Player A's nonce (post-snapshot) ───────────────────────
      await incrementNonceTx(tx, userId);

      // ── 8. GameBet record (PENDING) ─────────────────────────────────────────
      await tx.gameBet.create({
        data: {
          userId,
          gameType: "COINFLIP",
          stakeGzo: String(stake),
          status: "PENDING",
          idempotencyKey: `${match.id}:${userId}`,
          referenceId: match.id,
          serverSeedHash: commitHash,
          clientSeed: seeds.clientSeed,
          nonce,
        },
      });

      // ── 9. Audit log ────────────────────────────────────────────────────────
      await tx.auditLog.create({
        data: {
          userId,
          action: "coinflip.create",
          entity: "CoinflipMatch",
          entityId: match.id,
          metadata: { stake, side, commitHash, nonce },
        },
      });

      return { matchId: match.id, commitHash, nonce };
    });

    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    if (msg === "Insufficient balance" || msg.startsWith("House treasury")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("coinflip/create error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
