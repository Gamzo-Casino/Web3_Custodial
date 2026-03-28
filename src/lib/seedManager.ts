/**
 * Player Seed State Manager.
 *
 * Each player has a per-user "active server seed" commitment scheme:
 *   - serverSeed     : secret HMAC key, NEVER returned via API
 *   - serverSeedHash : SHA-256(serverSeed), shown to the player before any bet
 *   - clientSeed     : player-settable, contributes entropy to each round
 *   - nonce          : increments once per settled bet where user is Player A
 *
 * Flow per match (PvP coinflip):
 *   1. Create:  snapshot Player A's serverSeed + nonce → store in CoinflipCommit + GameBet
 *               increment Player A's nonce
 *   2. Settle:  HMAC(serverSeed, playerB.clientSeed:publicSeed:nonce)
 *               rotate Player A's serverSeed → reveal old seed
 *               increment Player B's nonce
 *   3. Reveal:  revealedSeed stored in GameBet.serverSeedRevealed + CoinflipCommit
 *
 * SECURITY: serverSeed is rotated AFTER the bet settles, never before.
 */

import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

function genSeed(): string {
  return randomBytes(32).toString("hex");
}

function hashSeed(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

/** Public-safe view of a player's current seed state. */
export interface PublicSeedState {
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  /** Hash of the previously revealed server seed, if any. */
  prevServerSeedHash: string | null;
}

// ── Public helpers (no transaction) ──────────────────────────────────────────

/**
 * Get or lazily create a player's public seed state.
 * Never returns the raw serverSeed.
 */
export async function getSeedStatePublic(userId: string): Promise<PublicSeedState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let state = await (prisma as any).playerSeedState.findUnique({ where: { userId } });
  if (!state) {
    state = await _createSeedState(userId);
  }
  return {
    serverSeedHash: state.serverSeedHash as string,
    clientSeed: state.clientSeed as string,
    nonce: state.nonce as number,
    prevServerSeedHash: (state.prevServerSeedHash as string | null) ?? null,
  };
}

/** Update the player's client seed. Caller must validate length/content. */
export async function setClientSeed(userId: string, clientSeed: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).playerSeedState.update({
    where: { userId },
    data: { clientSeed },
  });
}

// ── Transaction helpers (must be called inside $transaction) ─────────────────

/**
 * Initialise seed state for a user inside a transaction.
 * Idempotent: returns existing state if already initialised.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function initSeedStateTx(tx: any, userId: string) {
  const existing = await tx.playerSeedState.findUnique({ where: { userId } });
  if (existing) return existing;
  const seed = genSeed();
  return tx.playerSeedState.create({
    data: {
      userId,
      serverSeed: seed,
      serverSeedHash: hashSeed(seed),
      clientSeed: randomBytes(8).toString("hex"),
      nonce: 0,
    },
  });
}

/**
 * Get the seeds needed to place a bet (Player A role).
 * Creates seed state if it doesn't exist yet.
 * Returns { serverSeed, serverSeedHash, clientSeed, nonce } — nonce is the
 * value to use for this bet (before increment).
 */
export async function getBetSeedsTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  userId: string
): Promise<{ serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number }> {
  let state = await tx.playerSeedState.findUnique({ where: { userId } });
  if (!state) state = await initSeedStateTx(tx, userId);
  return {
    serverSeed: state.serverSeed as string,
    serverSeedHash: state.serverSeedHash as string,
    clientSeed: state.clientSeed as string,
    nonce: state.nonce as number,
  };
}

/**
 * Increment the player's global nonce inside a transaction.
 * Call once per settled bet where this player was Player A.
 * Returns the new nonce value (after increment).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function incrementNonceTx(tx: any, userId: string): Promise<number> {
  const updated = await tx.playerSeedState.update({
    where: { userId },
    data: { nonce: { increment: 1 } },
  });
  return updated.nonce as number;
}

/**
 * Rotate the player's server seed inside a transaction.
 *
 * - Reveals the OLD serverSeed (safe to return/store after bet settles)
 * - Commits a NEW serverSeed immediately
 * - Stores prevServerSeedHash for audit trail
 *
 * MUST be called AFTER bet settlement (never before) to preserve the
 * commit/reveal guarantee — the seed must not change until after outcome.
 *
 * Returns:
 *   revealedSeed  — the old serverSeed that was used for this bet
 *   newHash       — SHA-256 of the new serverSeed (safe to share)
 */
export async function rotateSeedTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  userId: string
): Promise<{ revealedSeed: string; newHash: string }> {
  const state = await tx.playerSeedState.findUniqueOrThrow({ where: { userId } });
  const revealedSeed = state.serverSeed as string;
  const newSeed = genSeed();
  const newHash = hashSeed(newSeed);

  await tx.playerSeedState.update({
    where: { userId },
    data: {
      serverSeed: newSeed,
      serverSeedHash: newHash,
      prevServerSeedHash: state.serverSeedHash as string,
    },
  });

  return { revealedSeed, newHash };
}

/**
 * Get Player B's client seed inside a transaction (for use as HMAC input).
 * Creates seed state if missing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getClientSeedTx(tx: any, userId: string): Promise<string> {
  let state = await tx.playerSeedState.findUnique({ where: { userId } });
  if (!state) state = await initSeedStateTx(tx, userId);
  return state.clientSeed as string;
}

// ── Private ───────────────────────────────────────────────────────────────────

async function _createSeedState(userId: string) {
  const seed = genSeed();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma as any).playerSeedState.create({
    data: {
      userId,
      serverSeed: seed,
      serverSeedHash: hashSeed(seed),
      clientSeed: randomBytes(8).toString("hex"),
      nonce: 0,
    },
  });
}
