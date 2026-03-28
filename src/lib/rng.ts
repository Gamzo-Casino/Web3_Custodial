/**
 * Provably fair RNG primitives — algorithm version 1.
 *
 * Core formula:
 *   bytes = HMAC-SHA256(key=serverSeed, data="clientSeed:publicSeed:nonce")
 *
 * The 32-byte output is deterministic for any fixed input tuple and can be
 * independently reproduced by anyone who holds the revealed serverSeed.
 */

import { createHmac } from "crypto";

/** Algorithm version embedded in GameBet.resultJson for future auditability. */
export const RNG_VERSION = 1;

/**
 * Derive 32 raw random bytes from a seed triplet + nonce.
 * This is the single source of entropy for all game outcomes.
 */
export function hmacSha256Bytes(
  serverSeed: string,
  clientSeed: string,
  publicSeed: string,
  nonce: number
): Buffer {
  const message = `${clientSeed}:${publicSeed}:${nonce}`;
  return createHmac("sha256", serverSeed).update(message).digest();
}

/**
 * Convert HMAC bytes to a uniform float in [0, 1).
 *
 * Uses 52-bit IEEE 754 mantissa extraction to eliminate modulo bias.
 * Combines the top 32 bits (hi) and the next 20 bits (lo >>> 12) to form
 * a 52-bit integer, then divides by 2^52.
 */
export function bytesToFloat(bytes: Buffer): number {
  const hi = bytes.readUInt32BE(0);
  const lo = bytes.readUInt32BE(4);
  const mantissa = hi * 2 ** 20 + (lo >>> 12);
  return mantissa / 2 ** 52;
}

/**
 * Convert HMAC bytes to a uniform integer in [min, max] inclusive.
 *
 * Delegates to bytesToFloat for an unbiased result over any range ≤ 2^52.
 */
export function bytesToInt(bytes: Buffer, min: number, max: number): number {
  if (min > max) throw new RangeError(`min (${min}) must be ≤ max (${max})`);
  const range = max - min + 1;
  return min + Math.floor(bytesToFloat(bytes) * range);
}

/**
 * Convert HMAC bytes to a dice roll in [0.00, 99.99].
 *
 * Multiplies the [0,1) float by 10000, floors to an integer in [0, 9999],
 * then divides by 100 to produce a two-decimal-place value in [0.00, 99.99].
 */
export function bytesToDiceRoll(bytes: Buffer): number {
  return Math.floor(bytesToFloat(bytes) * 10000) / 100;
}

/**
 * Convert HMAC bytes to a Plinko ball path.
 *
 * For each row i (0..rows-1), uses bit 0 (LSB) of byte i:
 *   1 → right, 0 → left
 * Supports up to 32 rows (HMAC-SHA256 produces 32 bytes).
 * bin index = path.filter(Boolean).length  (number of right steps)
 */
export function bytesToPlinkoPath(bytes: Buffer, rows: number): boolean[] {
  const path: boolean[] = [];
  for (let i = 0; i < rows; i++) {
    path.push((bytes[i] & 1) === 1);
  }
  return path;
}

/**
 * Map HMAC bytes to a coin-flip outcome.
 *
 * Uses the high nibble (top 4 bits) of the first byte — equivalent to the
 * first hex character of the HMAC digest string — for compatibility with the
 * original coinflip.ts computeOutcome implementation.
 *
 * High nibble even → HEADS, odd → TAILS.
 */
export function bytesToCoinFlip(bytes: Buffer): "HEADS" | "TAILS" {
  const highNibble = (bytes[0] >> 4) & 0xf;
  return highNibble % 2 === 0 ? "HEADS" : "TAILS";
}

/**
 * Convert HMAC bytes to an Aviator fly-away point in [1.00, 10000.00].
 *
 * Uses inverse-CDF on a skewed Pareto distribution.
 * 3% of rounds produce 1.00 (instant crash — house edge).
 * Power-law skew β=0.8 shifts distribution toward lower multipliers.
 *
 * @see src/lib/aviator.ts for the standalone version with constants.
 */
export function bytesToAviatorPoint(bytes: Buffer): number {
  const h = bytesToFloat(bytes);
  if (h < 0.03) return 1.0;
  const h2 = Math.pow(h, 0.8);
  if (h2 >= 0.9999) return 10000.0;
  return Math.floor(100 / (1 - h2)) / 100;
}

/**
 * Fisher-Yates shuffle of [1..40], returning the first 10 as the Keno draw.
 *
 * Requires at least 78 bytes of input (2 bytes × 39 shuffle steps).
 * Uses uint16BE reads for negligible modulo bias (max range 40, resolution 65536).
 * Returns the 10 drawn numbers sorted ascending for display.
 */
export function bytesToKenoDraw(bytes: Buffer): number[] {
  const deck: number[] = Array.from({ length: 40 }, (_, i) => i + 1);
  for (let i = 39; i > 0; i--) {
    const offset = (39 - i) * 2; // bytes 0..76 (39 steps × 2 bytes each)
    const rnd = bytes.readUInt16BE(offset);
    const j = rnd % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, 10).sort((a, b) => a - b);
}
