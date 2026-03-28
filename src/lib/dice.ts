/**
 * Dice game logic — provably fair, machine vs player.
 *
 * Algorithm:
 *   roll = bytesToDiceRoll(HMAC-SHA256(serverSeed, "clientSeed:publicSeed:nonce"))
 *   win  = roll < target
 *   multiplier = 99.0 / target  (simple MVP — no additional house edge parameter)
 *   grossPayout = floor(stake × multiplier)  on win, 0 on loss
 */

import { hmacSha256Bytes, bytesToDiceRoll } from "@/lib/rng";

/**
 * Deterministic publicSeed for a solo dice round.
 * Contains the userId so each player's roll is distinct, even with
 * the same serverSeed + clientSeed + nonce.
 */
export function computeDicePublicSeed(userId: string): string {
  return `dice:${userId}`;
}

/**
 * Compute a dice roll for the given seed tuple.
 * Returns a value in [0.00, 99.99] with 2 decimal places.
 */
export function computeDiceRoll(
  serverSeed: string,
  clientSeed: string,
  publicSeed: string,
  nonce: number
): number {
  return bytesToDiceRoll(hmacSha256Bytes(serverSeed, clientSeed, publicSeed, nonce));
}

/**
 * Gross payout multiplier for ROLL_UNDER mode.
 * multiplier = 99.0 / target
 */
export function computeDiceMultiplier(target: number): number {
  return 99.0 / target;
}

/**
 * Gross payout (before fee) for a winning dice bet.
 * Floors to the nearest integer GZO.
 */
export function computeDiceGrossPayout(stakeGzo: number, target: number): number {
  return Math.floor(stakeGzo * computeDiceMultiplier(target));
}
