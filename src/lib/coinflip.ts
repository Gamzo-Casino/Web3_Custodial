import { createHash, randomBytes } from "crypto";
import { settle, WIN_FEE_RATE, type SettlementResult } from "@/lib/settlement";
import { hmacSha256Bytes, bytesToCoinFlip } from "@/lib/rng";

export { WIN_FEE_RATE };
export const NONCE = 1;

/** Generate a cryptographically secure server seed (64 hex chars). */
export function generateServerSeed(): string {
  return randomBytes(32).toString("hex");
}

/** SHA-256 hash of the server seed — published as the public commitment. */
export function hashServerSeed(serverSeed: string): string {
  return createHash("sha256").update(serverSeed).digest("hex");
}

/**
 * Compute the coin-flip outcome deterministically.
 * HMAC-SHA256(key=serverSeed, data="clientSeed:publicSeed:nonce")
 * Take first hex char → even = HEADS, odd = TAILS.
 */
export function computeOutcome(
  serverSeed: string,
  clientSeed: string,
  publicSeed: string,
  nonce: number = NONCE
): "HEADS" | "TAILS" {
  return bytesToCoinFlip(hmacSha256Bytes(serverSeed, clientSeed, publicSeed, nonce));
}

/**
 * Compute the public seed from deterministic inputs (no DB storage needed).
 * publicSeed = matchId:playerBId
 */
export function computePublicSeed(matchId: string, playerBId: string): string {
  return `${matchId}:${playerBId}`;
}

/**
 * Compute PvP coinflip payout for the winner using the shared settlement function.
 *
 * Accounting (stake = S):
 *   gross    = 2S  (winner takes both bets from house escrow)
 *   profit   = S
 *   fee      = 10% × S  (WIN_FEE_RATE × profit)
 *   netPayout = 1.9 × S
 *
 * Returns full SettlementResult plus { winnerPayout, fee } aliases.
 */
export function computePayout(stake: number): SettlementResult & {
  winnerPayout: number;
  fee: number;
} {
  const result = settle(stake, stake * 2);
  return {
    ...result,
    winnerPayout: result.netPayoutGzo,
    fee: result.feeGzo,
  };
}

/** Generate a random client seed if the user does not supply one. */
export function generateClientSeed(): string {
  return randomBytes(8).toString("hex");
}
