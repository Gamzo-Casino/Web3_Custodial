/**
 * European Roulette — provably fair, machine vs player.
 *
 * Algorithm (version 1):
 *   bytes = HMAC-SHA256(serverSeed, "clientSeed:publicSeed:nonce")
 *   winningNumber = readUInt32BE(bytes, 0) % 37   → [0..36]
 *
 * Payout table (gross payout includes stake return):
 *   Straight (single number): 36× gross  (35:1 profit)
 *   Red / Black:               2× gross  (1:1 profit)
 *   Odd / Even:                2× gross  (1:1 profit)
 *   Low (1-18) / High (19-36): 2× gross  (1:1 profit)
 *   Dozen (1-12/13-24/25-36): 3× gross  (2:1 profit)
 *   Column (col1/col2/col3):  3× gross  (2:1 profit)
 */

import { createHmac } from "crypto";

export const ROULETTE_VERSION = 1;

// European roulette wheel order (for animation)
export const WHEEL_ORDER = [
  0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26
];

export const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

export function getColor(n: number): "red" | "black" | "green" {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

export function computeRoulettePublicSeed(userId: string): string {
  return `roulette:${userId}`;
}

export function computeRouletteNumber(
  serverSeed: string,
  clientSeed: string,
  publicSeed: string,
  nonce: number
): number {
  const bytes = createHmac("sha256", serverSeed)
    .update(`${clientSeed}:${publicSeed}:${nonce}`)
    .digest();
  return bytes.readUInt32BE(0) % 37;
}

// ── Payout table ──────────────────────────────────────────────────────────────
// grossMultiplier: how many times the stake comes back on win (includes stake)
export const PAYOUT_MULTIPLIERS: Record<string, number> = {
  // Outside bets
  red: 2, black: 2,
  odd: 2, even: 2,
  low: 2, high: 2,
  dozen1: 3, dozen2: 3, dozen3: 3,
  col1: 3, col2: 3, col3: 3,
};
// Straight bets are special: area = "straight:N" where N is 0-36 → 36×

export type Wager = { area: string; stake: number };

export function isValidArea(area: string): boolean {
  if (PAYOUT_MULTIPLIERS[area] !== undefined) return true;
  if (/^straight:\d+$/.test(area)) {
    const n = parseInt(area.split(":")[1]);
    return n >= 0 && n <= 36;
  }
  return false;
}

export function getGrossMultiplier(area: string): number {
  if (PAYOUT_MULTIPLIERS[area]) return PAYOUT_MULTIPLIERS[area];
  if (/^straight:\d+$/.test(area)) return 36;
  return 0;
}

export function doesBetWin(area: string, winningNumber: number): boolean {
  const color = getColor(winningNumber);
  switch (area) {
    case "red":    return color === "red";
    case "black":  return color === "black";
    case "odd":    return winningNumber !== 0 && winningNumber % 2 === 1;
    case "even":   return winningNumber !== 0 && winningNumber % 2 === 0;
    case "low":    return winningNumber >= 1 && winningNumber <= 18;
    case "high":   return winningNumber >= 19 && winningNumber <= 36;
    case "dozen1": return winningNumber >= 1 && winningNumber <= 12;
    case "dozen2": return winningNumber >= 13 && winningNumber <= 24;
    case "dozen3": return winningNumber >= 25 && winningNumber <= 36;
    case "col1":   return winningNumber > 0 && winningNumber % 3 === 1;
    case "col2":   return winningNumber > 0 && winningNumber % 3 === 2;
    case "col3":   return winningNumber > 0 && winningNumber % 3 === 0;
    default: {
      if (/^straight:\d+$/.test(area)) {
        return parseInt(area.split(":")[1]) === winningNumber;
      }
      return false;
    }
  }
}

export interface WagerResult {
  area: string;
  stake: number;
  won: boolean;
  grossPayout: number; // 0 if lost, stake * multiplier if won
}

export interface RoundResult {
  winningNumber: number;
  winningColor: "red" | "black" | "green";
  breakdown: WagerResult[];
  totalStake: number;
  totalGrossPayout: number;
}

export function settleRound(wagers: Wager[], winningNumber: number): RoundResult {
  const winningColor = getColor(winningNumber);
  let totalGrossPayout = 0;
  const breakdown: WagerResult[] = [];

  for (const w of wagers) {
    const won = doesBetWin(w.area, winningNumber);
    const grossPayout = won ? Math.floor(w.stake * getGrossMultiplier(w.area)) : 0;
    totalGrossPayout += grossPayout;
    breakdown.push({ area: w.area, stake: w.stake, won, grossPayout });
  }

  return {
    winningNumber,
    winningColor,
    breakdown,
    totalStake: wagers.reduce((s, w) => s + w.stake, 0),
    totalGrossPayout,
  };
}
