/**
 * Aviator game logic — provably fair, single-player vs house.
 *
 * Real-time game: player places a bet, multiplier climbs in real time,
 * player can cash out at any moment. The fly-away (crash) point is
 * predetermined by HMAC-SHA256 but hidden until the round ends.
 *
 * Multiplier curve (shared client & server):
 *   multiplier(t) = floor(e^(SPEED × t_ms) × 100) / 100
 *
 * Fly-away point distribution (inverse-CDF Pareto):
 *   3% instant bust at 1.00×, power-law skew β=0.8
 */

import { hmacSha256Bytes, bytesToFloat } from "@/lib/rng";

// ── Constants ────────────────────────────────────────────────────────────────

/** 3% of rounds crash instantly at 1.00× (house edge) */
export const AVIATOR_BUST_THRESHOLD = 0.03;

/** Power-law skew — shifts distribution toward lower multipliers */
const AVIATOR_SKEW = 0.8;

/** Maximum fly-away point (cap) */
export const AVIATOR_MAX_POINT = 10000.0;

/** Minimum cashout multiplier */
export const AVIATOR_MIN_TARGET = 1.01;

/** Maximum cashout multiplier */
export const AVIATOR_MAX_TARGET = 10000.0;

/**
 * Speed constant for the exponential multiplier curve.
 * Controls how fast the multiplier rises per millisecond.
 *
 * At SPEED = 0.00006:
 *   5s  → 1.35×     10s → 1.82×
 *   20s → 3.32×     30s → 6.05×
 *   60s → 36.6×    100s → 403×
 */
export const AVIATOR_SPEED = 0.00006;

/** Version tag for auditability */
export const AVIATOR_VERSION = 1;

// ── Multiplier curve (shared client & server) ────────────────────────────────

/**
 * Compute multiplier at a given elapsed time in milliseconds.
 * Both client animation and server validation use this exact formula.
 */
export function getMultiplierAtTime(elapsedMs: number): number {
  return Math.floor(Math.exp(AVIATOR_SPEED * elapsedMs) * 100) / 100;
}

/**
 * Compute elapsed time (ms) to reach a given multiplier.
 * Inverse of getMultiplierAtTime.
 */
export function getTimeForMultiplier(mult: number): number {
  if (mult <= 1) return 0;
  return Math.log(mult) / AVIATOR_SPEED;
}

/**
 * Compute the crash time (ms from start) for a given fly-away point.
 * The round crashes when the multiplier reaches this point.
 */
export function getCrashTimeMs(flyAwayPoint: number): number {
  return getTimeForMultiplier(flyAwayPoint);
}

// ── RNG ──────────────────────────────────────────────────────────────────────

/**
 * Convert HMAC bytes to an Aviator fly-away point in [1.00, 10000.00].
 *
 * 3% of rounds produce 1.00 (instant crash — house wins all).
 * A power-law skew (β=0.8) shifts the distribution:
 *   P(fly ≤   3×) ≈ 60%
 *   P(fly ≤   5×) ≈ 76%
 *   P(fly ≤  10×) ≈ 88%
 *   P(fly ≤ 100×) ≈ 99%
 */
export function bytesToAviatorPoint(bytes: Buffer): number {
  const h = bytesToFloat(bytes);
  if (h < AVIATOR_BUST_THRESHOLD) return 1.0;
  const h2 = Math.pow(h, AVIATOR_SKEW);
  if (h2 >= 0.9999) return AVIATOR_MAX_POINT;
  return Math.floor(100 / (1 - h2)) / 100;
}

// ── Public helpers ───────────────────────────────────────────────────────────

/** Deterministic publicSeed for a solo aviator round. */
export function computeAviatorPublicSeed(userId: string): string {
  return `aviator:${userId}`;
}

/** Compute the fly-away point for the given seed tuple. */
export function computeAviatorFlyAwayPoint(
  serverSeed: string,
  clientSeed: string,
  publicSeed: string,
  nonce: number
): number {
  return bytesToAviatorPoint(
    hmacSha256Bytes(serverSeed, clientSeed, publicSeed, nonce)
  );
}

/** Gross payout (before fee) for a winning aviator bet. */
export function computeAviatorGrossPayout(
  stakeGzo: number,
  cashoutMultiplier: number
): number {
  return Math.floor(stakeGzo * cashoutMultiplier);
}

/** Win probability for a given cashout target (approximate). */
export function computeAviatorWinProbability(target: number): number {
  if (target <= 1) return 1;
  return Math.min(1, 1 / target);
}
