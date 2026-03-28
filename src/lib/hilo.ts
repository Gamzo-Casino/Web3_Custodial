/**
 * Hilo game logic — provably fair Higher/Lower/Same card guessing game.
 *
 * Rules:
 *   - 52-card deck, reshuffled each round
 *   - A starting card is revealed; player guesses Higher, Lower, or Same for the next card
 *   - Ace is highest (value 14), 2 is lowest (value 2)
 *   - Ties are a LOSS for Higher/Lower; only Same wins on ties
 *   - Multiplier = floor(51 / favorable_count × 100) / 100 per guess
 *   - Cumulative multiplier multiplied on each correct guess
 *   - Player can cashout at any point after ≥1 correct guess
 *
 * Fairness: deck order derived from HMAC-SHA256(serverSeed, msg) over 4 rounds.
 */

import { createHmac } from "crypto";

export const HILO_VERSION = 1;

// ─── Card Types ───────────────────────────────────────────────────────────────
// rank 0..12 → 2,3,4,5,6,7,8,9,10,J,Q,K,A
// suit 0..3  → ♠,♥,♦,♣
// value = rank + 2 → 2..14 (Ace = 14)

export interface HiloCard {
  rank: number;  // 0-12
  suit: number;  // 0-3
  value: number; // 2-14
}

export const HILO_RANK_LABELS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
export const HILO_SUIT_SYMBOLS = ["♠","♥","♦","♣"];

export function hiloCardFromIndex(idx: number): HiloCard {
  const rank = idx % 13;
  return { rank, suit: Math.floor(idx / 13), value: rank + 2 };
}

export function isRedHiloCard(c: HiloCard): boolean {
  return c.suit === 1 || c.suit === 2; // hearts or diamonds
}

export function hiloCardLabel(c: HiloCard): string {
  return HILO_RANK_LABELS[c.rank] + HILO_SUIT_SYMBOLS[c.suit];
}

// ─── Deck Generation ──────────────────────────────────────────────────────────

export function computeHiloPublicSeed(userId: string): string {
  return `hilo:${userId}`;
}

/**
 * Generate a deterministic shuffled deck (52 card indices, 0-51).
 * Uses Fisher-Yates with 128 bytes of HMAC-SHA256 entropy (4 × 32 bytes).
 */
export function generateHiloDeck(
  serverSeed: string,
  clientSeed: string,
  publicSeed: string,
  nonce: number
): number[] {
  const buffers: Buffer[] = [];
  for (let i = 0; i < 4; i++) {
    const msg = i === 0
      ? `${clientSeed}:${publicSeed}:${nonce}`
      : `${clientSeed}:${publicSeed}:${nonce}:${i}`;
    buffers.push(createHmac("sha256", serverSeed).update(msg).digest());
  }
  const bytes = Buffer.concat(buffers); // 128 bytes

  const deck: number[] = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const offset = (51 - i) * 2;
    const rnd = bytes.readUInt16BE(offset);
    const j = rnd % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ─── Multipliers ──────────────────────────────────────────────────────────────

export type HiloGuess = "higher" | "lower" | "same";
export type HiloGuessResult = "win" | "loss";

/**
 * Number of favorable cards in the remaining 51 cards.
 */
export function favorableCount(currentValue: number, guess: HiloGuess): number {
  switch (guess) {
    case "higher": return (14 - currentValue) * 4;      // values (currentValue+1)..14
    case "lower":  return (currentValue - 2) * 4;       // values 2..(currentValue-1)
    case "same":   return 3;                             // 3 remaining of same rank
  }
}

/**
 * Per-guess multiplier: floor(51 / favorable × 100) / 100
 * Returns 0 if the guess is impossible (e.g. "higher" on Ace, "lower" on 2).
 */
export function getGuessMultiplier(currentValue: number, guess: HiloGuess): number {
  const favorable = favorableCount(currentValue, guess);
  if (favorable <= 0) return 0;
  return Math.floor((51 / favorable) * 100) / 100;
}

/**
 * Evaluate a guess: win or loss.
 * Ties are a loss for Higher/Lower.
 */
export function evaluateGuess(
  currentValue: number,
  nextValue: number,
  guess: HiloGuess
): HiloGuessResult {
  switch (guess) {
    case "higher": return nextValue > currentValue ? "win" : "loss";
    case "lower":  return nextValue < currentValue ? "win" : "loss";
    case "same":   return nextValue === currentValue ? "win" : "loss";
  }
}

// ─── Game State ───────────────────────────────────────────────────────────────

export interface HiloGuessHistoryEntry {
  guess: HiloGuess;
  result: HiloGuessResult;
  cardBefore: HiloCard;
  cardAfter: HiloCard;
  multiplierBefore: number;
  multiplierAfter: number;
}

export interface HiloGameState {
  roundId: string;
  status: "ACTIVE" | "CASHED_OUT" | "LOST";
  stakeGzo: number;
  currentCard: HiloCard;
  currentMultiplier: number;
  guessHistory: HiloGuessHistoryEntry[];
  grossPayoutGzo: number | null;
  profitGzo: number | null;
  feeGzo: number | null;
  netPayoutGzo: number | null;
  balanceAfter: number | null;
  serverSeedHash: string;
  /** Revealed only after settlement. */
  serverSeed: string | null;
  clientSeed: string;
  nonce: number;
  publicSeed: string;
  /** Multipliers for each possible guess on the current card. */
  higherMultiplier: number;
  lowerMultiplier: number;
  sameMultiplier: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildHiloState(round: any, balanceAfter?: number): HiloGameState {
  const deck: number[] = JSON.parse(round.deckJson as string);
  const deckIndex: number = round.deckIndex as number;
  // deck[deckIndex - 1] is the last-drawn (currently displayed) card
  const currentCardIdx = deck[deckIndex - 1];
  const currentCard = hiloCardFromIndex(currentCardIdx);
  const currentMultiplier = Number(round.currentMultiplier);
  const isSettled = round.status !== "ACTIVE";

  const guessHistory: HiloGuessHistoryEntry[] = JSON.parse(
    typeof round.guessHistory === "string" ? round.guessHistory : JSON.stringify(round.guessHistory ?? [])
  );

  return {
    roundId: round.id as string,
    status: round.status as "ACTIVE" | "CASHED_OUT" | "LOST",
    stakeGzo: Number(round.stakeGzo),
    currentCard,
    currentMultiplier,
    guessHistory,
    grossPayoutGzo: round.grossPayoutGzo != null ? Number(round.grossPayoutGzo) : null,
    profitGzo:     round.profitGzo     != null ? Number(round.profitGzo)     : null,
    feeGzo:        round.feeGzo        != null ? Number(round.feeGzo)        : null,
    netPayoutGzo:  round.netPayoutGzo  != null ? Number(round.netPayoutGzo)  : null,
    balanceAfter: balanceAfter ?? null,
    serverSeedHash: round.serverSeedHash as string,
    serverSeed: isSettled ? (round.serverSeed as string) : null,
    clientSeed: round.clientSeed as string,
    nonce: round.nonce as number,
    publicSeed: round.publicSeed as string,
    higherMultiplier: getGuessMultiplier(currentCard.value, "higher"),
    lowerMultiplier:  getGuessMultiplier(currentCard.value, "lower"),
    sameMultiplier:   getGuessMultiplier(currentCard.value, "same"),
  };
}
