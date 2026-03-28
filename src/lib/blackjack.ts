/**
 * Blackjack game logic — provably fair, European Blackjack rules.
 *
 * Rules:
 *   - Single deck, reshuffled each hand
 *   - Dealer stands on soft 17 (S17)
 *   - Blackjack pays 3:2 (natural only; split-hand 21 pays 1:1)
 *   - Player may split on same point value (K-Q can split)
 *   - Player may double on first 2 cards (including after split)
 *   - No insurance, no re-split
 *
 * Fairness: deck order derived from HMAC-SHA256(serverSeed, msg) over 4 rounds.
 */

import { createHmac } from "crypto";

export const BLACKJACK_VERSION = 1;

// ─── Card Types ───────────────────────────────────────────────────────────────
// rank 0..12 → 2,3,4,5,6,7,8,9,10,J,Q,K,A
// suit 0..3  → ♠,♥,♦,♣

export interface Card {
  rank: number; // 0-12
  suit: number; // 0-3
}

export const RANK_LABELS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
export const SUIT_SYMBOLS = ["♠","♥","♦","♣"];

// Point values: 2-9 face value, 10/J/Q/K = 10, A = 11 (soft, adjusted below)
const RANK_POINT_VALUES = [2,3,4,5,6,7,8,9,10,10,10,10,11];

export function cardLabel(c: Card): string {
  return RANK_LABELS[c.rank] + SUIT_SYMBOLS[c.suit];
}

export function isRedCard(c: Card): boolean {
  return c.suit === 1 || c.suit === 2; // hearts or diamonds
}

export function cardPointValue(c: Card): number {
  return RANK_POINT_VALUES[c.rank];
}

export function cardFromIndex(idx: number): Card {
  return { rank: idx % 13, suit: Math.floor(idx / 13) };
}

// ─── Hand Evaluation ──────────────────────────────────────────────────────────

/**
 * Total value of a hand, optimally counting aces as 11 or 1.
 */
export function handValue(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += RANK_POINT_VALUES[c.rank];
    if (c.rank === 12) aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

export function isSoftHand(cards: Card[]): boolean {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += RANK_POINT_VALUES[c.rank];
    if (c.rank === 12) aces++;
  }
  return aces > 0 && total <= 21;
}

/** Natural blackjack: exactly 2 cards totalling 21. */
export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards) === 21;
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards) > 21;
}

/** Can split: 2 cards with same point value (K-Q both 10 can split). */
export function canSplitHand(cards: Card[]): boolean {
  if (cards.length !== 2) return false;
  return RANK_POINT_VALUES[cards[0].rank] === RANK_POINT_VALUES[cards[1].rank];
}

// ─── Deck Generation ──────────────────────────────────────────────────────────

export function computeBlackjackPublicSeed(userId: string): string {
  return `blackjack:${userId}`;
}

/**
 * Generate a deterministic shuffled deck (52 card indices, 0-51).
 * Uses Fisher-Yates with 128 bytes of HMAC-SHA256 entropy (4 × 32 bytes).
 * Needs 51 × 2 = 102 bytes for shuffle steps.
 */
export function generateShuffledDeck(
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

// ─── Dealer Play ──────────────────────────────────────────────────────────────

/**
 * Dealer draws until reaching 17+ (S17: stands on soft 17).
 * Returns the updated card-value array and new deck pointer.
 */
export function dealerPlay(
  dealerCardValues: number[],
  deckCardValues: number[],
  deckIndex: number
): { finalCardValues: number[]; finalDeckIndex: number } {
  const values = [...dealerCardValues];
  let idx = deckIndex;
  while (true) {
    const val = handValue(values.map(cardFromIndex));
    if (val >= 17) break;
    if (idx >= deckCardValues.length) break; // safety guard
    values.push(deckCardValues[idx++]);
  }
  return { finalCardValues: values, finalDeckIndex: idx };
}

// ─── Outcome & Payouts ────────────────────────────────────────────────────────

export type HandOutcome = "BLACKJACK" | "WIN" | "PUSH" | "LOSS";

/**
 * Compare player vs dealer hands.
 * @param isSplitHand - Split-hand 21 with 2 cards is WIN not BLACKJACK (industry standard).
 */
export function compareHands(
  playerCards: Card[],
  dealerCards: Card[],
  isSplitHand = false
): HandOutcome {
  if (isBust(playerCards)) return "LOSS";
  const playerBJ = !isSplitHand && isBlackjack(playerCards);
  const dealerBJ = isBlackjack(dealerCards);
  if (playerBJ && dealerBJ) return "PUSH";
  if (playerBJ) return "BLACKJACK";
  if (dealerBJ) return "LOSS";
  if (isBust(dealerCards)) return "WIN";
  const pv = handValue(playerCards);
  const dv = handValue(dealerCards);
  if (pv > dv) return "WIN";
  if (pv === dv) return "PUSH";
  return "LOSS";
}

/**
 * Gross payout (before fee) for a settled hand.
 * BLACKJACK: stake + 1.5× stake = 2.5× (3:2 pays)
 * WIN:       stake + stake = 2×
 * PUSH:      stake returned = 1×
 * LOSS:      0
 */
export function handGrossPayout(stake: number, outcome: HandOutcome): number {
  switch (outcome) {
    case "BLACKJACK": return Math.floor(stake * 2.5);
    case "WIN":       return stake * 2;
    case "PUSH":      return stake;
    case "LOSS":      return 0;
  }
}

// ─── Game State Builder ───────────────────────────────────────────────────────

export interface BlackjackGameState {
  roundId: string;
  status: "ACTIVE" | "SETTLED";
  activeHand: 0 | 1;
  playerCards: Card[];
  splitCards: Card[] | null;
  /** Dealer's face-up card (always visible). */
  dealerUpCard: Card;
  /** All dealer cards — null while round is ACTIVE (hole card hidden). */
  dealerCards: Card[] | null;
  playerTotal: number;
  splitTotal: number | null;
  dealerTotal: number | null;
  mainOutcome: HandOutcome | null;
  splitOutcome: HandOutcome | null;
  mainStakeGzo: number;
  splitStakeGzo: number | null;
  mainDoubled: boolean;
  splitDoubled: boolean;
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
  canHit: boolean;
  canStand: boolean;
  canDouble: boolean;
  canSplit: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildGameState(round: any, balanceAfter?: number): BlackjackGameState {
  const playerValues: number[] = JSON.parse(round.playerCards as string);
  const dealerValues: number[] = JSON.parse(round.dealerCards as string);
  const splitValues: number[] | null = round.splitCards
    ? JSON.parse(round.splitCards as string) : null;

  const playerCards = playerValues.map(cardFromIndex);
  const dealerAllCards = dealerValues.map(cardFromIndex);
  const splitCards = splitValues ? splitValues.map(cardFromIndex) : null;

  const isSettled = round.status === "SETTLED";
  const activeHand = (round.activeHand ?? 0) as 0 | 1;
  const mainDoubled = Boolean(round.mainDoubled);
  const splitDoubled = Boolean(round.splitDoubled);

  const activeCards = activeHand === 0 ? playerCards : (splitCards ?? playerCards);
  const currentDoubled = activeHand === 0 ? mainDoubled : splitDoubled;

  const canAct = !isSettled;
  const activeBust = isBust(activeCards);

  const canHit    = canAct && !activeBust && !currentDoubled;
  const canStand  = canAct && !activeBust;
  const canDouble = canAct && activeCards.length === 2 && !currentDoubled && !activeBust;
  const canSplit  = canAct && activeHand === 0 && !splitCards
    && playerCards.length === 2 && canSplitHand(playerCards) && !mainDoubled;

  return {
    roundId: round.id as string,
    status: round.status as "ACTIVE" | "SETTLED",
    activeHand,
    playerCards,
    splitCards,
    dealerUpCard: dealerAllCards[0],  // first card is always face-up
    dealerCards: isSettled ? dealerAllCards : null,
    playerTotal: handValue(playerCards),
    splitTotal: splitCards ? handValue(splitCards) : null,
    dealerTotal: isSettled ? handValue(dealerAllCards) : null,
    mainOutcome: (round.mainOutcome ?? null) as HandOutcome | null,
    splitOutcome: (round.splitOutcome ?? null) as HandOutcome | null,
    mainStakeGzo: Number(round.mainStakeGzo),
    splitStakeGzo: round.splitStakeGzo != null ? Number(round.splitStakeGzo) : null,
    mainDoubled,
    splitDoubled,
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
    canHit,
    canStand,
    canDouble,
    canSplit,
  };
}
