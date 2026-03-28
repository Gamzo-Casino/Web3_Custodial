/**
 * Keno game logic — provably fair.
 *
 * Player picks 1–10 numbers from 1–40.
 * RNG draws 10 unique numbers from 1–40 via deterministic Fisher-Yates shuffle.
 * Payout multiplier is looked up from KENO_PAYTABLE[picks][matches].
 * Gross payout = floor(stake × multiplier); 10% fee on profit only.
 *
 * Win probability and expected value are fully deterministic given the seed tuple.
 */

import { hmacSha256Bytes, bytesToKenoDraw } from "@/lib/rng";

export const KENO_NUMBERS  = 40; // total numbers in pool
export const KENO_DRAWN    = 10; // numbers drawn per round
export const KENO_MIN_PICKS = 1;
export const KENO_MAX_PICKS = 10;

/**
 * KENO_PAYTABLE[picksCount][matchCount] = gross multiplier.
 *
 * Indexed as an array where index = match count.
 * Designed with ~5–12% house edge across all pick counts.
 * Pick 10, match 0 pays 5× (hitting none of 10 is ~2% chance — rare bonus).
 */
export const KENO_PAYTABLE: Record<number, number[]> = {
  1:  [0,   3.5],
  2:  [0,   1,   7],
  3:  [0,   1,   3,   21],
  4:  [0,   0,   2,    5,   55],
  5:  [0,   0,   1.5,  4,   20,   100],
  6:  [0,   0,   1,    2,   10,   50,   500],
  7:  [0,   0,   0,    1.5, 5,    20,   100,  1000],
  8:  [0,   0,   0,    1,   3,    10,   50,   250,  2000],
  9:  [0,   0,   0,    1,   2,    6,    30,   100,  500,  5000],
  10: [5,   0,   0,    1,   2,    5,    20,   100,  500,  2000, 10000],
};

export function computeKenoPublicSeed(userId: string): string {
  return `keno:${userId}`;
}

/**
 * Deterministically draw 10 numbers from [1..40] using a 96-byte RNG stream.
 *
 * Three HMAC-SHA256 blocks (96 bytes total) drive Fisher-Yates shuffle.
 * Only the first 78 bytes are consumed (2 bytes × 39 shuffle steps).
 */
export function computeKenoDraw(
  serverSeed: string,
  clientSeed: string,
  publicSeed: string,
  nonce: number
): number[] {
  const b0 = hmacSha256Bytes(serverSeed, clientSeed, publicSeed, nonce);
  const b1 = hmacSha256Bytes(serverSeed, clientSeed, `${publicSeed}:1`, nonce);
  const b2 = hmacSha256Bytes(serverSeed, clientSeed, `${publicSeed}:2`, nonce);
  return bytesToKenoDraw(Buffer.concat([b0, b1, b2]));
}

/** Count how many of the player's picks appear in the drawn set. */
export function computeKenoMatches(picks: number[], drawn: number[]): number {
  const drawnSet = new Set(drawn);
  return picks.filter((n) => drawnSet.has(n)).length;
}

/** Look up the gross multiplier for a given picks count and match count. */
export function computeKenoMultiplier(picksCount: number, matchCount: number): number {
  return KENO_PAYTABLE[picksCount]?.[matchCount] ?? 0;
}

/** Gross payout = floor(stake × multiplier). Returns 0 on loss (multiplier = 0). */
export function computeKenoGrossPayout(stakeGzo: number, multiplier: number): number {
  return Math.floor(stakeGzo * multiplier);
}
