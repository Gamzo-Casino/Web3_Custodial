/**
 * Mines game logic — provably fair, machine vs player.
 *
 * Algorithm (version 1):
 *   bytes  = concat(
 *     HMAC-SHA256(serverSeed, "clientSeed:publicSeed:nonce:0"),
 *     HMAC-SHA256(serverSeed, "clientSeed:publicSeed:nonce:1")
 *   )
 *   Fisher-Yates shuffle tiles[0..boardSize-1] using uint16BE reads from bytes.
 *   minePositions = first mineCount tiles after shuffle, sorted ascending.
 *
 * Multiplier after K safe picks:
 *   mult = C(boardSize, K) / C(boardSize − mineCount, K)
 *   This is the fair (unweighted) multiplier; 10% fee on profit applied via settle().
 */

import { createHmac } from "crypto";

export const MINES_VERSION = 1;
export const MINES_BOARD_SIZE = 25; // 5 × 5

/** Deterministic public seed for a solo Mines round. */
export function computeMinesPublicSeed(userId: string): string {
  return `mines:${userId}`;
}

/**
 * Generate 64 bytes of deterministic randomness.
 * Two HMAC-SHA256 invocations give 64 bytes — enough for 24 shuffle steps × 2 bytes.
 */
function minesHmacStream(
  serverSeed: string,
  clientSeed: string,
  publicSeed: string,
  nonce: number
): Buffer {
  const b0 = createHmac("sha256", serverSeed)
    .update(`${clientSeed}:${publicSeed}:${nonce}:0`)
    .digest();
  const b1 = createHmac("sha256", serverSeed)
    .update(`${clientSeed}:${publicSeed}:${nonce}:1`)
    .digest();
  return Buffer.concat([b0, b1]);
}

/**
 * Compute mine positions via Fisher-Yates shuffle.
 * Returns sorted array of tile indices [0..boardSize-1] that are mines.
 *
 * Independent verifiability:
 *   bytes = concat(HMAC(seed,"cs:ps:n:0"), HMAC(seed,"cs:ps:n:1"))
 *   for i = boardSize-1 downto 1:
 *     j = readUInt16BE(bytes, (boardSize-1-i)*2) % (i+1)
 *     swap(tiles[i], tiles[j])
 *   mines = sort(tiles[0..mineCount-1])
 */
export function computeMinePositions(
  serverSeed: string,
  clientSeed: string,
  publicSeed: string,
  nonce: number,
  boardSize: number = MINES_BOARD_SIZE,
  mineCount: number
): number[] {
  const bytes = minesHmacStream(serverSeed, clientSeed, publicSeed, nonce);
  const tiles = Array.from({ length: boardSize }, (_, i) => i);

  for (let i = boardSize - 1; i > 0; i--) {
    const offset = (boardSize - 1 - i) * 2;
    const rnd = bytes.readUInt16BE(offset);
    const j = rnd % (i + 1);
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }

  return tiles.slice(0, mineCount).sort((a, b) => a - b);
}

/** Binomial coefficient C(n, k). */
function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let c = 1;
  for (let i = 0; i < k; i++) {
    c = (c * (n - i)) / (i + 1);
  }
  return c;
}

/**
 * Gross payout multiplier after K safe picks.
 *
 * Formula: C(boardSize, K) / C(boardSize − mineCount, K)
 * Returns 1.00 at K=0 (no picks yet).
 */
export function computeMinesMultiplier(
  boardSize: number,
  mineCount: number,
  safePicks: number
): number {
  if (safePicks <= 0) return 1.0;
  const safeTotal = boardSize - mineCount;
  if (safePicks > safeTotal) return 0;
  const num = comb(boardSize, safePicks);
  const den = comb(safeTotal, safePicks);
  if (den === 0) return 0;
  return Math.round((num / den) * 100) / 100;
}

/** Gross payout (before fee) for a Mines cashout. Floors to integer GZO. */
export function computeMinesGrossPayout(stakeGzo: number, multiplier: number): number {
  return Math.floor(stakeGzo * multiplier);
}

/**
 * Maximum gross multiplier when all safe tiles are revealed.
 * Used for house solvency check at game start.
 */
export function computeMinesMaxMultiplier(boardSize: number, mineCount: number): number {
  return computeMinesMultiplier(boardSize, mineCount, boardSize - mineCount);
}
