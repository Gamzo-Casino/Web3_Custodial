/**
 * Hilo game logic tests.
 */

import {
  hiloCardFromIndex,
  isRedHiloCard,
  hiloCardLabel,
  favorableCount,
  getGuessMultiplier,
  evaluateGuess,
  generateHiloDeck,
  computeHiloPublicSeed,
  buildHiloState,
  HILO_VERSION,
  type HiloCard,
} from "@/lib/hilo";

// ─── hiloCardFromIndex ────────────────────────────────────────────────────────

describe("hiloCardFromIndex", () => {
  test("index 0 → rank 0, suit 0, value 2", () => {
    const c = hiloCardFromIndex(0);
    expect(c).toEqual({ rank: 0, suit: 0, value: 2 });
  });

  test("index 12 → rank 12 (Ace), suit 0, value 14", () => {
    const c = hiloCardFromIndex(12);
    expect(c).toEqual({ rank: 12, suit: 0, value: 14 });
  });

  test("index 13 → rank 0, suit 1, value 2", () => {
    const c = hiloCardFromIndex(13);
    expect(c).toEqual({ rank: 0, suit: 1, value: 2 });
  });

  test("index 51 → rank 12 (Ace), suit 3, value 14", () => {
    const c = hiloCardFromIndex(51);
    expect(c).toEqual({ rank: 12, suit: 3, value: 14 });
  });

  test("index 8 → rank 8 (Ten), value 10", () => {
    const c = hiloCardFromIndex(8);
    expect(c.rank).toBe(8);
    expect(c.value).toBe(10);
  });

  test("all 52 indices produce unique (rank, suit) pairs", () => {
    const pairs = new Set(
      Array.from({ length: 52 }, (_, i) => {
        const c = hiloCardFromIndex(i);
        return `${c.rank}:${c.suit}`;
      })
    );
    expect(pairs.size).toBe(52);
  });

  test("values range from 2 to 14", () => {
    const values = new Set(Array.from({ length: 52 }, (_, i) => hiloCardFromIndex(i).value));
    expect(Math.min(...values)).toBe(2);
    expect(Math.max(...values)).toBe(14);
  });
});

// ─── isRedHiloCard ────────────────────────────────────────────────────────────

describe("isRedHiloCard", () => {
  test("suit 0 (spades) is black", () => {
    expect(isRedHiloCard({ rank: 0, suit: 0, value: 2 })).toBe(false);
  });
  test("suit 1 (hearts) is red", () => {
    expect(isRedHiloCard({ rank: 0, suit: 1, value: 2 })).toBe(true);
  });
  test("suit 2 (diamonds) is red", () => {
    expect(isRedHiloCard({ rank: 0, suit: 2, value: 2 })).toBe(true);
  });
  test("suit 3 (clubs) is black", () => {
    expect(isRedHiloCard({ rank: 0, suit: 3, value: 2 })).toBe(false);
  });
});

// ─── hiloCardLabel ────────────────────────────────────────────────────────────

describe("hiloCardLabel", () => {
  test("Ace of spades → A♠", () => {
    expect(hiloCardLabel({ rank: 12, suit: 0, value: 14 })).toBe("A♠");
  });
  test("2 of hearts → 2♥", () => {
    expect(hiloCardLabel({ rank: 0, suit: 1, value: 2 })).toBe("2♥");
  });
  test("10 of diamonds → 10♦", () => {
    expect(hiloCardLabel({ rank: 8, suit: 2, value: 10 })).toBe("10♦");
  });
  test("King of clubs → K♣", () => {
    expect(hiloCardLabel({ rank: 11, suit: 3, value: 13 })).toBe("K♣");
  });
});

// ─── favorableCount ───────────────────────────────────────────────────────────

describe("favorableCount", () => {
  test("higher on 7 → (14-7)×4 = 28", () => {
    expect(favorableCount(7, "higher")).toBe(28);
  });
  test("lower on 7 → (7-2)×4 = 20", () => {
    expect(favorableCount(7, "lower")).toBe(20);
  });
  test("same on any card → 3", () => {
    expect(favorableCount(7, "same")).toBe(3);
    expect(favorableCount(2, "same")).toBe(3);
    expect(favorableCount(14, "same")).toBe(3);
  });
  test("higher on Ace (14) → 0 (impossible)", () => {
    expect(favorableCount(14, "higher")).toBe(0);
  });
  test("lower on 2 → 0 (impossible)", () => {
    expect(favorableCount(2, "lower")).toBe(0);
  });
  test("higher on 2 → (14-2)×4 = 48", () => {
    expect(favorableCount(2, "higher")).toBe(48);
  });
  test("lower on 14 (Ace) → (14-2)×4 = 48", () => {
    expect(favorableCount(14, "lower")).toBe(48);
  });
  test("favorable counts sum correctly for mid card", () => {
    // For value 7: higher=28, lower=20, same=3 — total is not 51 (different from 51 remaining deck)
    const h = favorableCount(7, "higher");
    const l = favorableCount(7, "lower");
    const s = favorableCount(7, "same");
    // 4 cards of value 7 exist; one is the current → 3 same
    // 7>2: lower = (7-2)*4=20, higher = (14-7)*4=28
    expect(h + l + s).toBe(51); // should total 51
  });
});

// ─── getGuessMultiplier ───────────────────────────────────────────────────────

describe("getGuessMultiplier", () => {
  test("returns 0 for impossible guess (higher on Ace)", () => {
    expect(getGuessMultiplier(14, "higher")).toBe(0);
  });
  test("returns 0 for impossible guess (lower on 2)", () => {
    expect(getGuessMultiplier(2, "lower")).toBe(0);
  });
  test("higher on 7 → floor(51/28 × 100)/100 = 1.82", () => {
    expect(getGuessMultiplier(7, "higher")).toBe(1.82);
  });
  test("lower on 7 → floor(51/20 × 100)/100", () => {
    const expected = Math.floor((51 / 20) * 100) / 100;
    expect(getGuessMultiplier(7, "lower")).toBe(expected);
  });
  test("same on any → floor(51/3 × 100)/100 = 17", () => {
    expect(getGuessMultiplier(7, "same")).toBe(17);
  });
  test("higher on 2 → floor(51/48 × 100)/100", () => {
    const expected = Math.floor((51 / 48) * 100) / 100;
    expect(getGuessMultiplier(2, "higher")).toBe(expected);
  });
  test("multiplier is always ≥ 1 for valid guesses", () => {
    for (let v = 2; v <= 14; v++) {
      const h = getGuessMultiplier(v, "higher");
      const l = getGuessMultiplier(v, "lower");
      const s = getGuessMultiplier(v, "same");
      if (h > 0) expect(h).toBeGreaterThanOrEqual(1);
      if (l > 0) expect(l).toBeGreaterThanOrEqual(1);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeGreaterThanOrEqual(1);
    }
  });
});

// ─── evaluateGuess ────────────────────────────────────────────────────────────

describe("evaluateGuess", () => {
  test("higher: next > current → win", () => {
    expect(evaluateGuess(7, 10, "higher")).toBe("win");
  });
  test("higher: next = current → loss (tie is loss)", () => {
    expect(evaluateGuess(7, 7, "higher")).toBe("loss");
  });
  test("higher: next < current → loss", () => {
    expect(evaluateGuess(7, 3, "higher")).toBe("loss");
  });
  test("lower: next < current → win", () => {
    expect(evaluateGuess(10, 5, "lower")).toBe("win");
  });
  test("lower: next = current → loss (tie is loss)", () => {
    expect(evaluateGuess(10, 10, "lower")).toBe("loss");
  });
  test("lower: next > current → loss", () => {
    expect(evaluateGuess(10, 14, "lower")).toBe("loss");
  });
  test("same: next = current → win", () => {
    expect(evaluateGuess(7, 7, "same")).toBe("win");
  });
  test("same: next > current → loss", () => {
    expect(evaluateGuess(7, 8, "same")).toBe("loss");
  });
  test("same: next < current → loss", () => {
    expect(evaluateGuess(7, 6, "same")).toBe("loss");
  });
});

// ─── generateHiloDeck ────────────────────────────────────────────────────────

describe("generateHiloDeck", () => {
  const SS = "test-server-seed-hilo";
  const CS = "test-client-seed-hilo";
  const PS = "hilo:user123";
  const N  = 1;

  test("returns array of length 52", () => {
    const deck = generateHiloDeck(SS, CS, PS, N);
    expect(deck).toHaveLength(52);
  });

  test("contains each index 0-51 exactly once", () => {
    const deck = generateHiloDeck(SS, CS, PS, N);
    const sorted = [...deck].sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });

  test("is deterministic with same inputs", () => {
    const deck1 = generateHiloDeck(SS, CS, PS, N);
    const deck2 = generateHiloDeck(SS, CS, PS, N);
    expect(deck1).toEqual(deck2);
  });

  test("differs with different nonce", () => {
    const deck1 = generateHiloDeck(SS, CS, PS, 1);
    const deck2 = generateHiloDeck(SS, CS, PS, 2);
    expect(deck1).not.toEqual(deck2);
  });

  test("differs with different server seed", () => {
    const deck1 = generateHiloDeck("seed-a", CS, PS, N);
    const deck2 = generateHiloDeck("seed-b", CS, PS, N);
    expect(deck1).not.toEqual(deck2);
  });

  test("differs with different client seed", () => {
    const deck1 = generateHiloDeck(SS, "client-a", PS, N);
    const deck2 = generateHiloDeck(SS, "client-b", PS, N);
    expect(deck1).not.toEqual(deck2);
  });

  test("deck is not trivially sorted (shuffled)", () => {
    const deck = generateHiloDeck(SS, CS, PS, N);
    const sorted = Array.from({ length: 52 }, (_, i) => i);
    expect(deck).not.toEqual(sorted);
  });
});

// ─── computeHiloPublicSeed ────────────────────────────────────────────────────

describe("computeHiloPublicSeed", () => {
  test("formats as hilo:<userId>", () => {
    expect(computeHiloPublicSeed("abc123")).toBe("hilo:abc123");
  });
});

// ─── buildHiloState ───────────────────────────────────────────────────────────

describe("buildHiloState", () => {
  function makeRound(overrides: Record<string, unknown> = {}) {
    const deck = Array.from({ length: 52 }, (_, i) => i); // deck[0]=0(2♠), deck[1]=1(3♠)...
    return {
      id: "round-1",
      status: "ACTIVE",
      stakeGzo: "500",
      deckJson: JSON.stringify(deck),
      deckIndex: 1,
      currentMultiplier: "1",
      guessHistory: "[]",
      grossPayoutGzo: null,
      profitGzo: null,
      feeGzo: null,
      netPayoutGzo: null,
      serverSeedHash: "hash-abc",
      serverSeed: "secret-seed",
      clientSeed: "client-xyz",
      nonce: 3,
      publicSeed: "hilo:user1",
      rngVersion: HILO_VERSION,
      ...overrides,
    };
  }

  test("returns correct roundId and status", () => {
    const state = buildHiloState(makeRound());
    expect(state.roundId).toBe("round-1");
    expect(state.status).toBe("ACTIVE");
  });

  test("currentCard is deck[deckIndex-1]", () => {
    // deck[0] = 0 → { rank: 0, suit: 0, value: 2 }
    const state = buildHiloState(makeRound({ deckIndex: 1 }));
    expect(state.currentCard).toEqual({ rank: 0, suit: 0, value: 2 });
  });

  test("currentCard at deckIndex=2 is deck[1]", () => {
    // deck[1] = 1 → { rank: 1, suit: 0, value: 3 }
    const state = buildHiloState(makeRound({ deckIndex: 2 }));
    expect(state.currentCard).toEqual({ rank: 1, suit: 0, value: 3 });
  });

  test("serverSeed hidden while ACTIVE", () => {
    const state = buildHiloState(makeRound({ status: "ACTIVE" }));
    expect(state.serverSeed).toBeNull();
  });

  test("serverSeed revealed when CASHED_OUT", () => {
    const state = buildHiloState(makeRound({ status: "CASHED_OUT" }));
    expect(state.serverSeed).toBe("secret-seed");
  });

  test("serverSeed revealed when LOST", () => {
    const state = buildHiloState(makeRound({ status: "LOST" }));
    expect(state.serverSeed).toBe("secret-seed");
  });

  test("higherMultiplier reflects current card value", () => {
    // deck[0] = 0 → value 2; higher mult = floor(51/48*100)/100
    const state = buildHiloState(makeRound({ deckIndex: 1 }));
    const expected = Math.floor((51 / 48) * 100) / 100;
    expect(state.higherMultiplier).toBe(expected);
  });

  test("lowerMultiplier is 0 for value 2 (impossible)", () => {
    const state = buildHiloState(makeRound({ deckIndex: 1 }));
    expect(state.lowerMultiplier).toBe(0);
  });

  test("sameMultiplier is always 17", () => {
    const state = buildHiloState(makeRound());
    expect(state.sameMultiplier).toBe(17);
  });

  test("payouts are null when ACTIVE", () => {
    const state = buildHiloState(makeRound({ status: "ACTIVE" }));
    expect(state.grossPayoutGzo).toBeNull();
    expect(state.profitGzo).toBeNull();
    expect(state.netPayoutGzo).toBeNull();
  });

  test("payouts returned when CASHED_OUT", () => {
    const state = buildHiloState(makeRound({
      status: "CASHED_OUT",
      grossPayoutGzo: "600",
      profitGzo: "100",
      feeGzo: "10",
      netPayoutGzo: "590",
    }));
    expect(state.grossPayoutGzo).toBe(600);
    expect(state.profitGzo).toBe(100);
    expect(state.feeGzo).toBe(10);
    expect(state.netPayoutGzo).toBe(590);
  });

  test("balanceAfter passed through", () => {
    const state = buildHiloState(makeRound(), 12345);
    expect(state.balanceAfter).toBe(12345);
  });

  test("guessHistory parsed from JSON string", () => {
    const history = [{ guess: "higher", result: "win", cardBefore: { rank: 0, suit: 0, value: 2 }, cardAfter: { rank: 1, suit: 0, value: 3 }, multiplierBefore: 1, multiplierAfter: 1.06 }];
    const state = buildHiloState(makeRound({ guessHistory: JSON.stringify(history) }));
    expect(state.guessHistory).toHaveLength(1);
    expect(state.guessHistory[0].guess).toBe("higher");
  });
});

// ─── HILO_VERSION ─────────────────────────────────────────────────────────────

describe("HILO_VERSION", () => {
  test("is 1", () => {
    expect(HILO_VERSION).toBe(1);
  });
});

// ─── Multiplier accumulation ──────────────────────────────────────────────────

describe("multiplier accumulation", () => {
  test("two wins compound correctly", () => {
    const m1 = getGuessMultiplier(7, "same");   // floor(51/3*100)/100 = 17
    const m2 = getGuessMultiplier(7, "lower");  // floor(51/20*100)/100
    const cum1 = Math.floor(1 * m1 * 100) / 100;
    const cum2 = Math.floor(cum1 * m2 * 100) / 100;
    expect(cum1).toBe(17);
    expect(cum2).toBe(Math.floor(17 * m2 * 100) / 100);
  });

  test("cashout payout = floor(stake × multiplier)", () => {
    const stake = 500;
    const multiplier = 2.55;
    const gross = Math.floor(stake * multiplier);
    expect(gross).toBe(1275);
  });
});
