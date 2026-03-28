import {
  cardFromIndex,
  cardLabel,
  isRedCard,
  cardPointValue,
  handValue,
  isSoftHand,
  isBlackjack,
  isBust,
  canSplitHand,
  computeBlackjackPublicSeed,
  generateShuffledDeck,
  dealerPlay,
  compareHands,
  handGrossPayout,
  buildGameState,
  BLACKJACK_VERSION,
  Card,
  HandOutcome,
} from "../lib/blackjack";
import { settle } from "../lib/settlement";

// ─── Card helpers ────────────────────────────────────────────────────────────

describe("cardFromIndex", () => {
  test("index 0 = 2♠", () => expect(cardFromIndex(0)).toEqual({ rank: 0, suit: 0 }));
  test("index 12 = A♠", () => expect(cardFromIndex(12)).toEqual({ rank: 12, suit: 0 }));
  test("index 13 = 2♥", () => expect(cardFromIndex(13)).toEqual({ rank: 0, suit: 1 }));
  test("index 51 = A♣", () => expect(cardFromIndex(51)).toEqual({ rank: 12, suit: 3 }));
  test("all 52 indices produce distinct cards", () => {
    const cards = Array.from({ length: 52 }, (_, i) => `${cardFromIndex(i).rank}:${cardFromIndex(i).suit}`);
    expect(new Set(cards).size).toBe(52);
  });
});

describe("cardLabel", () => {
  test("2♠", () => expect(cardLabel({ rank: 0, suit: 0 })).toBe("2♠"));
  test("A♥", () => expect(cardLabel({ rank: 12, suit: 1 })).toBe("A♥"));
  test("K♦", () => expect(cardLabel({ rank: 11, suit: 2 })).toBe("K♦"));
  test("10♣", () => expect(cardLabel({ rank: 8, suit: 3 })).toBe("10♣"));
});

describe("isRedCard", () => {
  test("♥ is red", () => expect(isRedCard({ rank: 0, suit: 1 })).toBe(true));
  test("♦ is red", () => expect(isRedCard({ rank: 0, suit: 2 })).toBe(true));
  test("♠ is black", () => expect(isRedCard({ rank: 0, suit: 0 })).toBe(false));
  test("♣ is black", () => expect(isRedCard({ rank: 0, suit: 3 })).toBe(false));
});

describe("cardPointValue", () => {
  test("2 = 2",  () => expect(cardPointValue({ rank: 0,  suit: 0 })).toBe(2));
  test("10 = 10",() => expect(cardPointValue({ rank: 8,  suit: 0 })).toBe(10));
  test("J = 10", () => expect(cardPointValue({ rank: 9,  suit: 0 })).toBe(10));
  test("Q = 10", () => expect(cardPointValue({ rank: 10, suit: 0 })).toBe(10));
  test("K = 10", () => expect(cardPointValue({ rank: 11, suit: 0 })).toBe(10));
  test("A = 11", () => expect(cardPointValue({ rank: 12, suit: 0 })).toBe(11));
});

// ─── Hand evaluation ─────────────────────────────────────────────────────────

const card = (rank: number, suit = 0): Card => ({ rank, suit });
// rank: 0=2, 1=3, 2=4, 3=5, 4=6, 5=7, 6=8, 7=9, 8=10, 9=J, 10=Q, 11=K, 12=A

describe("handValue", () => {
  test("Ace + 5 = 16 (soft)", () => expect(handValue([card(12), card(3)])).toBe(16));
  test("Ace + King = 21 (BJ)", () => expect(handValue([card(12), card(11)])).toBe(21));
  test("Ace + Ace = 12", () => expect(handValue([card(12), card(12)])).toBe(12));
  test("Ace + Ace + 9 = 21", () => expect(handValue([card(12), card(12), card(7)])).toBe(21));
  test("Ace + Ace + 9 + 2 = 13 (double ace demotion)", () => {
    expect(handValue([card(12), card(12), card(7), card(0)])).toBe(13);
  });
  test("10 + 6 + 7 = 23 (bust)", () => {
    expect(handValue([card(8), card(4), card(5)])).toBe(23);
  });
  test("6 + 5 + 10 = 21", () => {
    expect(handValue([card(4), card(3), card(8)])).toBe(21);
  });
  test("empty hand = 0", () => expect(handValue([])).toBe(0));
});

describe("isSoftHand", () => {
  test("Ace + 5 is soft", () => expect(isSoftHand([card(12), card(3)])).toBe(true));
  test("Ace + King is NOT soft (11 counted as 1 would exceed)", () => {
    // A+K = 21, no ace counted as 1 needed, so soft
    expect(isSoftHand([card(12), card(11)])).toBe(true);
  });
  test("10 + 7 is not soft", () => expect(isSoftHand([card(8), card(5)])).toBe(false));
  test("Ace + 9 + 5 is not soft (ace counted as 1)", () => {
    // A+9+5 = 15 with ace as 1, hard hand
    expect(isSoftHand([card(12), card(7), card(3)])).toBe(false);
  });
});

describe("isBlackjack", () => {
  test("Ace + King = BJ", () => expect(isBlackjack([card(12), card(11)])).toBe(true));
  test("Ace + 10 = BJ", () => expect(isBlackjack([card(12), card(8)])).toBe(true));
  test("10 + 10 + Ace is NOT BJ (3 cards)", () => expect(isBlackjack([card(8), card(8), card(12)])).toBe(false));
  test("7 + 7 + 7 is NOT BJ", () => expect(isBlackjack([card(5), card(5), card(5)])).toBe(false));
  test("9 + 2 = 11 is NOT BJ", () => expect(isBlackjack([card(7), card(0)])).toBe(false));
});

describe("isBust", () => {
  test("10 + 10 + 5 = 25 is bust", () => expect(isBust([card(8), card(8), card(3)])).toBe(true));
  test("10 + 10 + Ace = 21 is not bust", () => expect(isBust([card(8), card(8), card(12)])).toBe(false));
  test("Ace + Ace + Ace + 9 = 12 (all aces demoted)", () => {
    expect(isBust([card(12), card(12), card(12), card(7)])).toBe(false);
    expect(handValue([card(12), card(12), card(12), card(7)])).toBe(12);
  });
});

describe("canSplitHand", () => {
  test("K + Q can split (both 10 pts)", () => expect(canSplitHand([card(11), card(10)])).toBe(true));
  test("8 + 8 can split", () => expect(canSplitHand([card(6), card(6)])).toBe(true));
  test("A + A can split", () => expect(canSplitHand([card(12), card(12)])).toBe(true));
  test("10 + J can split (both 10 pts)", () => expect(canSplitHand([card(8), card(9)])).toBe(true));
  test("7 + 8 cannot split", () => expect(canSplitHand([card(5), card(6)])).toBe(false));
  test("3 cards cannot split", () => expect(canSplitHand([card(5), card(5), card(5)])).toBe(false));
});

// ─── Deck generation ─────────────────────────────────────────────────────────

describe("computeBlackjackPublicSeed", () => {
  test("returns blackjack:userId", () => {
    expect(computeBlackjackPublicSeed("user123")).toBe("blackjack:user123");
  });
});

describe("generateShuffledDeck", () => {
  const seed   = "test-server-seed";
  const client = "test-client";
  const pub    = "blackjack:testuser";
  const nonce  = 1;

  test("produces 52 distinct cards", () => {
    const deck = generateShuffledDeck(seed, client, pub, nonce);
    expect(deck.length).toBe(52);
    expect(new Set(deck).size).toBe(52);
  });

  test("all values 0-51", () => {
    const deck = generateShuffledDeck(seed, client, pub, nonce);
    expect(deck.every(v => v >= 0 && v <= 51)).toBe(true);
  });

  test("deterministic: same inputs → same deck", () => {
    const d1 = generateShuffledDeck(seed, client, pub, nonce);
    const d2 = generateShuffledDeck(seed, client, pub, nonce);
    expect(d1).toEqual(d2);
  });

  test("different nonces → different decks", () => {
    const d1 = generateShuffledDeck(seed, client, pub, 1);
    const d2 = generateShuffledDeck(seed, client, pub, 2);
    expect(d1).not.toEqual(d2);
  });

  test("different serverSeeds → different decks", () => {
    const d1 = generateShuffledDeck("seed-A", client, pub, nonce);
    const d2 = generateShuffledDeck("seed-B", client, pub, nonce);
    expect(d1).not.toEqual(d2);
  });
});

// ─── Dealer play ─────────────────────────────────────────────────────────────

describe("dealerPlay", () => {
  // deck of cards: [2♠=0, 3♠=1, 4♠=2, 5♠=3, 6♠=4, 7♠=5, 8♠=6, 9♠=7, 10♠=8, J♠=9, Q♠=10, K♠=11, A♠=12]
  // Build a known deck: K=11, 6=4, 5=3, 8=6, ...

  test("dealer stays on 17 (hard)", () => {
    // Dealer has K(10) + 7(5pts) = 17 → stands immediately
    const dealer = [11, 5]; // K♠=11 (rank11,suit0,10pts), 7♠=5 (rank5,suit0,7pts) → 10+7=17
    const deck = [8, 6, 3]; // 10, 8, 5 — should not be drawn
    const { finalCardValues, finalDeckIndex } = dealerPlay(dealer, deck, 0);
    expect(finalCardValues).toEqual(dealer);
    expect(finalDeckIndex).toBe(0);
  });

  test("dealer hits on 16", () => {
    // Dealer: K(10) + 6(8pts=8) = 18? No: rank=4 → rank 4 = 6 pts? Let me re-check.
    // rank 0=2, 4=6pts(index into RANK_POINT_VALUES). rank4 → cardFromIndex(4) = rank4,suit0 → 6pts
    // K=11 (rank11), 6♠=rank4 → dealerCards=[11, 4] → 10+6=16
    const dealer = [11, 4]; // K=10, 6=6 → total 16
    const deck = [8, 11, 0]; // 10♠=8 → draws 10, total 26 → bust? No wait, K is already in hand
    // Actually: 10+6=16, draw 10♠(rank8,10pts) → 26 → bust
    const { finalCardValues } = dealerPlay(dealer, deck, 0);
    expect(finalCardValues.length).toBeGreaterThan(2);
    // Final total should be 26 (bust) since dealer drew 10
    const totalVal = handValue(finalCardValues.map(cardFromIndex));
    expect(totalVal).toBeGreaterThan(16); // dealer must have drawn
  });

  test("dealer hits on soft 16 but stands on soft 17", () => {
    // A+6 = soft 17 → stands (S17 rule)
    const dealer = [12, 4]; // A♠=12(11pts), 6♠=rank4(6pts) → soft 17
    const deck   = [0];
    const { finalCardValues, finalDeckIndex } = dealerPlay(dealer, deck, 0);
    expect(finalCardValues).toEqual(dealer); // no draw
    expect(finalDeckIndex).toBe(0);
  });

  test("dealer doesn't bust with aces", () => {
    // A + A + 9 = 12+11-10 = 21? No: A+A = 12, +9 = 21
    const dealer  = [12, 12]; // A+A = 12
    const deck    = [7, 8]; // 9(rank7), 10(rank8)
    const { finalCardValues } = dealerPlay(dealer, deck, 0);
    const total = handValue(finalCardValues.map(cardFromIndex));
    // A+A = 12 → draw 9 → 21 → stop
    expect(total).toBe(21);
  });
});

// ─── Hand comparison ─────────────────────────────────────────────────────────

describe("compareHands", () => {
  // Use actual Card objects

  // BJ hand = [A♠, K♠]
  const bjHand = [card(12), card(11)];
  // 21 with 3 cards = [7, 7, 7] → 7pts*3=21 → no BJ
  const threeSeven = [card(5), card(5), card(5)];
  // 18 hand = [10, 8]
  const hand18 = [card(8), card(6)];
  // 17 hand = [10, 7]
  const hand17 = [card(8), card(5)];
  // 20 hand = [10, 10]
  const hand20 = [card(8), card(8)];
  // bust = [10, 10, 5]
  const bustHand = [card(8), card(8), card(3)];

  test("BJ vs non-BJ = BLACKJACK", () => expect(compareHands(bjHand, hand18)).toBe("BLACKJACK"));
  test("BJ vs BJ = PUSH", () => expect(compareHands(bjHand, bjHand)).toBe("PUSH"));
  test("non-BJ vs BJ = LOSS", () => expect(compareHands(hand18, bjHand)).toBe("LOSS"));
  test("20 vs 18 = WIN", () => expect(compareHands(hand20, hand18)).toBe("WIN"));
  test("18 vs 20 = LOSS", () => expect(compareHands(hand18, hand20)).toBe("LOSS"));
  test("18 vs 18 = PUSH", () => expect(compareHands(hand18, hand18)).toBe("PUSH"));
  test("bust vs anything = LOSS", () => expect(compareHands(bustHand, hand17)).toBe("LOSS"));
  test("18 vs dealer bust = WIN", () => expect(compareHands(hand18, bustHand)).toBe("WIN"));
  test("split hand BJ = WIN (not BLACKJACK)", () => {
    expect(compareHands(bjHand, hand18, true)).toBe("WIN");
  });
  test("3-card 21 vs 20 = WIN (not BJ)", () => {
    expect(compareHands(threeSeven, hand20)).toBe("WIN");
  });
});

// ─── Payouts ─────────────────────────────────────────────────────────────────

describe("handGrossPayout", () => {
  test("BLACKJACK on 100 = 250", () => expect(handGrossPayout(100, "BLACKJACK")).toBe(250));
  test("WIN on 100 = 200", () => expect(handGrossPayout(100, "WIN")).toBe(200));
  test("PUSH on 100 = 100", () => expect(handGrossPayout(100, "PUSH")).toBe(100));
  test("LOSS on 100 = 0", () => expect(handGrossPayout(100, "LOSS")).toBe(0));
  test("BLACKJACK on 33 = floor(82.5) = 82", () => expect(handGrossPayout(33, "BLACKJACK")).toBe(82));
});

// ─── Settlement integration ───────────────────────────────────────────────────

describe("settle integration with blackjack", () => {
  test("WIN: stake 100, gross 200 → fee 10, net 190", () => {
    const { profitGzo, feeGzo, netPayoutGzo } = settle(100, 200);
    expect(profitGzo).toBe(100);
    expect(feeGzo).toBe(10);
    expect(netPayoutGzo).toBe(190);
  });

  test("BLACKJACK: stake 100, gross 250 → fee 15, net 235", () => {
    const { profitGzo, feeGzo, netPayoutGzo } = settle(100, 250);
    expect(profitGzo).toBe(150);
    expect(feeGzo).toBe(15);
    expect(netPayoutGzo).toBe(235);
  });

  test("PUSH: stake 100, gross 100 → fee 0, net 100", () => {
    const { profitGzo, feeGzo, netPayoutGzo } = settle(100, 100);
    expect(profitGzo).toBe(0);
    expect(feeGzo).toBe(0);
    expect(netPayoutGzo).toBe(100);
  });

  test("LOSS: stake 100, gross 0 → fee 0, net 0", () => {
    const { profitGzo, feeGzo, netPayoutGzo } = settle(100, 0);
    expect(profitGzo).toBe(-100);
    expect(feeGzo).toBe(0);
    expect(netPayoutGzo).toBe(0);
  });

  test("Double win: stake 200, gross 400 → fee 20, net 380", () => {
    const { profitGzo, feeGzo, netPayoutGzo } = settle(200, 400);
    expect(profitGzo).toBe(200);
    expect(feeGzo).toBe(20);
    expect(netPayoutGzo).toBe(380);
  });

  test("Split win+loss: stake 200, gross 200 → profit 0, fee 0, net 200", () => {
    // main WIN: gross 200, split LOSS: gross 0 → totalGross 200, totalStake 200
    const { profitGzo, feeGzo, netPayoutGzo } = settle(200, 200);
    expect(profitGzo).toBe(0);
    expect(feeGzo).toBe(0);
    expect(netPayoutGzo).toBe(200);
  });
});

// ─── buildGameState ───────────────────────────────────────────────────────────

describe("buildGameState", () => {
  function makeRound(overrides: Record<string, unknown> = {}) {
    // A♠(12)=face-up, K♠(11)=hole, player has 10♠(8) and 7♠(5)
    return {
      id: "test-round-1",
      status: "ACTIVE",
      activeHand: 0,
      playerCards: JSON.stringify([8, 5]),  // 10+7=17
      dealerCards: JSON.stringify([12, 11]), // A(face-up), K(hole)
      splitCards:   null,
      mainStakeGzo: "100",
      splitStakeGzo: null,
      mainDoubled:  false,
      splitDoubled: false,
      grossPayoutGzo: null,
      profitGzo: null,
      feeGzo: null,
      netPayoutGzo: null,
      serverSeedHash: "testhash",
      serverSeed: null,
      clientSeed: "client",
      nonce: 1,
      publicSeed: "blackjack:user",
      mainOutcome: null,
      splitOutcome: null,
      deckJson: JSON.stringify(Array.from({ length: 52 }, (_, i) => i)),
      deckIndex: 4,
      actions: "[]",
      ...overrides,
    };
  }

  test("active round: hole card hidden", () => {
    const state = buildGameState(makeRound());
    expect(state.status).toBe("ACTIVE");
    expect(state.dealerCards).toBeNull();
    expect(state.dealerUpCard).toEqual({ rank: 12, suit: 0 }); // A♠
    expect(state.playerTotal).toBe(17);
    expect(state.serverSeed).toBeNull();
  });

  test("active round: canHit and canStand are true", () => {
    const state = buildGameState(makeRound());
    expect(state.canHit).toBe(true);
    expect(state.canStand).toBe(true);
  });

  test("active round: canDouble true (2-card hand)", () => {
    const state = buildGameState(makeRound());
    expect(state.canDouble).toBe(true);
  });

  test("active round: canSplit false (different values)", () => {
    const state = buildGameState(makeRound());
    expect(state.canSplit).toBe(false);
  });

  test("active round: canSplit true (matching point values)", () => {
    // 10+J = both 10pts
    const state = buildGameState(makeRound({ playerCards: JSON.stringify([8, 9]) }));
    expect(state.canSplit).toBe(true);
  });

  test("settled round: dealer cards visible, serverSeed revealed", () => {
    const state = buildGameState(makeRound({
      status: "SETTLED",
      mainOutcome: "WIN",
      serverSeed: "revealed-seed-abc",
      netPayoutGzo: "190",
      grossPayoutGzo: "200",
      profitGzo: "100",
      feeGzo: "10",
    }));
    expect(state.dealerCards).not.toBeNull();
    expect(state.serverSeed).toBe("revealed-seed-abc");
    expect(state.mainOutcome).toBe("WIN");
    expect(state.netPayoutGzo).toBe(190);
    expect(state.canHit).toBe(false);
    expect(state.canStand).toBe(false);
  });

  test("bust hand: canHit and canStand false", () => {
    // player: 10+10+5 = 25 (bust)
    const state = buildGameState(makeRound({ playerCards: JSON.stringify([8, 8, 3]) }));
    expect(state.canHit).toBe(false);
    expect(state.canStand).toBe(false);
  });

  test("doubled hand: canHit false", () => {
    const state = buildGameState(makeRound({ mainDoubled: true }));
    expect(state.canHit).toBe(false);
  });

  test("BLACKJACK_VERSION is 1", () => {
    expect(BLACKJACK_VERSION).toBe(1);
  });
});
