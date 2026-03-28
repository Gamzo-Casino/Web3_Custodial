/**
 * Plinko game logic — provably fair, machine vs player.
 *
 * Algorithm:
 *   path = bytesToPlinkoPath(HMAC-SHA256(serverSeed, "clientSeed:publicSeed:nonce"), rows)
 *   binIndex = path.filter(Boolean).length  (0 = far left, rows = far right)
 *   multiplier = PLINKO_MULTIPLIERS[rows][risk][binIndex]
 *   grossPayout = floor(stake × multiplier)
 */

import { hmacSha256Bytes, bytesToPlinkoPath } from "@/lib/rng";

export type PlinkoRisk = "low" | "med" | "high";
export type PlinkoRows = 8 | 12 | 16;

export const PLINKO_ROWS: PlinkoRows[] = [8, 12, 16];
export const PLINKO_RISKS: PlinkoRisk[] = ["low", "med", "high"];

/** Version tag — bump if tables change so old bets remain auditable. */
export const PLINKO_MULTIPLIER_VERSION = 1;

/**
 * Multiplier tables indexed by [rows][risk][binIndex].
 *
 * Tables are symmetric (index i mirrors index rows-i).
 * House edge is baked in: EV < 1 on average.
 *
 *   8 rows  → 9 bins  (0..8)
 *   12 rows → 13 bins (0..12)
 *   16 rows → 17 bins (0..16)
 */
export const PLINKO_MULTIPLIERS: Record<PlinkoRows, Record<PlinkoRisk, number[]>> = {
  8: {
    low:  [5.6,  2.1,  1.1,  1.0,  0.5,  1.0,  1.1,  2.1,  5.6],
    med:  [13,   3,    1.3,  0.7,  0.4,  0.7,  1.3,  3,    13],
    high: [29,   4,    1.5,  0.3,  0.2,  0.3,  1.5,  4,    29],
  },
  12: {
    low:  [8.9,  3,    1.4,  1.1,  1.0,  0.5,  0.3,  0.5,  1.0,  1.1,  1.4,  3,    8.9],
    med:  [33,   11,   4,    2,    0.6,  0.3,  0.2,  0.3,  0.6,  2,    4,    11,   33],
    high: [170,  24,   8.1,  2,    0.7,  0.2,  0.2,  0.2,  0.7,  2,    8.1,  24,   170],
  },
  16: {
    low:  [16,   9,    2,    1.4,  1.4,  1.2,  1.1,  1.0,  0.5,  1.0,  1.1,  1.2,  1.4,  1.4,  2,    9,    16],
    med:  [110,  41,   10,   5,    3,    1.5,  1,    0.5,  0.3,  0.5,  1,    1.5,  3,    5,    10,   41,   110],
    high: [1000, 130,  26,   9,    4,    2,    0.2,  0.2,  0.2,  0.2,  0.2,  2,    4,    9,    26,   130,  1000],
  },
};

/** Deterministic public seed for a solo Plinko round. */
export function computePlinkoPublicSeed(userId: string): string {
  return `plinko:${userId}`;
}

/**
 * Compute the ball path for the given seed tuple.
 * Returns an array of `rows` booleans: true = right, false = left.
 */
export function computePlinkoPath(
  serverSeed: string,
  clientSeed: string,
  publicSeed: string,
  nonce: number,
  rows: PlinkoRows
): boolean[] {
  return bytesToPlinkoPath(
    hmacSha256Bytes(serverSeed, clientSeed, publicSeed, nonce),
    rows
  );
}

/**
 * Compute landing bin index from a path.
 * bin = number of right steps (0 = far left, rows = far right).
 */
export function computePlinkoBinIndex(path: boolean[]): number {
  return path.filter(Boolean).length;
}

/** Look up multiplier for the given rows/risk/bin combination. */
export function computePlinkoMultiplier(
  rows: PlinkoRows,
  risk: PlinkoRisk,
  binIndex: number
): number {
  return PLINKO_MULTIPLIERS[rows][risk][binIndex];
}

/**
 * Gross payout (before fee) for a Plinko bet.
 * Floors to the nearest integer GZO.
 */
export function computePlinkoGrossPayout(stakeGzo: number, multiplier: number): number {
  return Math.floor(stakeGzo * multiplier);
}
