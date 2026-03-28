/**
 * Roulette game logic tests
 */
import {
  computeRouletteNumber,
  computeRoulettePublicSeed,
  doesBetWin,
  getColor,
  getGrossMultiplier,
  isValidArea,
  settleRound,
  RED_NUMBERS,
  ROULETTE_VERSION,
  Wager,
} from "@/lib/roulette";
import { settle } from "@/lib/settlement";

// ── Color mapping ─────────────────────────────────────────────────────────────
describe("getColor", () => {
  test("0 is green", () => expect(getColor(0)).toBe("green"));
  test("red numbers are red", () => {
    for (const n of [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]) {
      expect(getColor(n)).toBe("red");
    }
  });
  test("black numbers are black", () => {
    for (const n of [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35]) {
      expect(getColor(n)).toBe("black");
    }
  });
  test("red set has 18 numbers", () => expect(RED_NUMBERS.size).toBe(18));
});

// ── isValidArea ───────────────────────────────────────────────────────────────
describe("isValidArea", () => {
  test.each(["red","black","odd","even","low","high","dozen1","dozen2","dozen3","col1","col2","col3"])(
    "%s is valid", (area) => expect(isValidArea(area)).toBe(true)
  );
  test("straight:0 is valid", () => expect(isValidArea("straight:0")).toBe(true));
  test("straight:36 is valid", () => expect(isValidArea("straight:36")).toBe(true));
  test("straight:37 is invalid", () => expect(isValidArea("straight:37")).toBe(false));
  test("straight:-1 is invalid", () => expect(isValidArea("straight:-1")).toBe(false));
  test("unknown area is invalid", () => expect(isValidArea("corner:1-5")).toBe(false));
  test("empty string is invalid", () => expect(isValidArea("")).toBe(false));
});

// ── getGrossMultiplier ────────────────────────────────────────────────────────
describe("getGrossMultiplier", () => {
  test("straight pays 36×", () => expect(getGrossMultiplier("straight:7")).toBe(36));
  test("red/black pays 2×", () => { expect(getGrossMultiplier("red")).toBe(2); expect(getGrossMultiplier("black")).toBe(2); });
  test("odd/even pays 2×", () => { expect(getGrossMultiplier("odd")).toBe(2); expect(getGrossMultiplier("even")).toBe(2); });
  test("low/high pays 2×", () => { expect(getGrossMultiplier("low")).toBe(2); expect(getGrossMultiplier("high")).toBe(2); });
  test("dozens pay 3×", () => { expect(getGrossMultiplier("dozen1")).toBe(3); expect(getGrossMultiplier("dozen2")).toBe(3); expect(getGrossMultiplier("dozen3")).toBe(3); });
  test("columns pay 3×", () => { expect(getGrossMultiplier("col1")).toBe(3); expect(getGrossMultiplier("col2")).toBe(3); expect(getGrossMultiplier("col3")).toBe(3); });
});

// ── doesBetWin ────────────────────────────────────────────────────────────────
describe("doesBetWin", () => {
  // Red/Black
  test("red wins on red number 1", () => expect(doesBetWin("red", 1)).toBe(true));
  test("red loses on black number 2", () => expect(doesBetWin("red", 2)).toBe(false));
  test("red loses on 0", () => expect(doesBetWin("red", 0)).toBe(false));
  test("black wins on 2", () => expect(doesBetWin("black", 2)).toBe(true));
  test("black loses on 1", () => expect(doesBetWin("black", 1)).toBe(false));
  test("black loses on 0", () => expect(doesBetWin("black", 0)).toBe(false));

  // Odd/Even
  test("odd wins on 1", () => expect(doesBetWin("odd", 1)).toBe(true));
  test("odd wins on 35", () => expect(doesBetWin("odd", 35)).toBe(true));
  test("odd loses on 0", () => expect(doesBetWin("odd", 0)).toBe(false));
  test("even wins on 2", () => expect(doesBetWin("even", 2)).toBe(true));
  test("even loses on 0", () => expect(doesBetWin("even", 0)).toBe(false));
  test("even loses on 1", () => expect(doesBetWin("even", 1)).toBe(false));

  // Low/High
  test("low wins on 1", () => expect(doesBetWin("low", 1)).toBe(true));
  test("low wins on 18", () => expect(doesBetWin("low", 18)).toBe(true));
  test("low loses on 19", () => expect(doesBetWin("low", 19)).toBe(false));
  test("low loses on 0", () => expect(doesBetWin("low", 0)).toBe(false));
  test("high wins on 19", () => expect(doesBetWin("high", 19)).toBe(true));
  test("high wins on 36", () => expect(doesBetWin("high", 36)).toBe(true));
  test("high loses on 18", () => expect(doesBetWin("high", 18)).toBe(false));
  test("high loses on 0", () => expect(doesBetWin("high", 0)).toBe(false));

  // Dozens
  test("dozen1 wins on 1", () => expect(doesBetWin("dozen1", 1)).toBe(true));
  test("dozen1 wins on 12", () => expect(doesBetWin("dozen1", 12)).toBe(true));
  test("dozen1 loses on 13", () => expect(doesBetWin("dozen1", 13)).toBe(false));
  test("dozen2 wins on 13", () => expect(doesBetWin("dozen2", 13)).toBe(true));
  test("dozen2 wins on 24", () => expect(doesBetWin("dozen2", 24)).toBe(true));
  test("dozen3 wins on 25", () => expect(doesBetWin("dozen3", 25)).toBe(true));
  test("dozen3 wins on 36", () => expect(doesBetWin("dozen3", 36)).toBe(true));

  // Columns (col1=1,4,7...34; col2=2,5,8...35; col3=3,6,9...36)
  test("col1 wins on 1", () => expect(doesBetWin("col1", 1)).toBe(true));
  test("col1 wins on 34", () => expect(doesBetWin("col1", 34)).toBe(true));
  test("col1 loses on 0", () => expect(doesBetWin("col1", 0)).toBe(false));
  test("col2 wins on 2", () => expect(doesBetWin("col2", 2)).toBe(true));
  test("col3 wins on 3", () => expect(doesBetWin("col3", 3)).toBe(true));
  test("col3 wins on 36", () => expect(doesBetWin("col3", 36)).toBe(true));

  // Straight
  test("straight:7 wins on 7", () => expect(doesBetWin("straight:7", 7)).toBe(true));
  test("straight:7 loses on 8", () => expect(doesBetWin("straight:7", 8)).toBe(false));
  test("straight:0 wins on 0", () => expect(doesBetWin("straight:0", 0)).toBe(true));
  test("straight:36 wins on 36", () => expect(doesBetWin("straight:36", 36)).toBe(true));
});

// ── settleRound ───────────────────────────────────────────────────────────────
describe("settleRound", () => {
  test("no winning bets returns 0 gross payout", () => {
    const result = settleRound([{ area: "red", stake: 100 }], 2); // 2 is black
    expect(result.totalGrossPayout).toBe(0);
    expect(result.breakdown[0].won).toBe(false);
    expect(result.breakdown[0].grossPayout).toBe(0);
  });

  test("red bet wins on red number", () => {
    const result = settleRound([{ area: "red", stake: 100 }], 1);
    expect(result.breakdown[0].won).toBe(true);
    expect(result.breakdown[0].grossPayout).toBe(200);
    expect(result.totalGrossPayout).toBe(200);
  });

  test("straight bet pays 36× on correct number", () => {
    const result = settleRound([{ area: "straight:17", stake: 10 }], 17);
    expect(result.breakdown[0].won).toBe(true);
    expect(result.breakdown[0].grossPayout).toBe(360);
  });

  test("dozen bet pays 3× on win", () => {
    const result = settleRound([{ area: "dozen1", stake: 50 }], 5);
    expect(result.breakdown[0].won).toBe(true);
    expect(result.breakdown[0].grossPayout).toBe(150);
  });

  test("multiple bets — mixed outcome", () => {
    const wagers: Wager[] = [
      { area: "red", stake: 100 },
      { area: "odd", stake: 50 },
      { area: "dozen1", stake: 25 },
    ];
    // Number 3: red, odd, dozen1 — all win
    const result = settleRound(wagers, 3);
    expect(result.breakdown.every(b => b.won)).toBe(true);
    expect(result.totalGrossPayout).toBe(200 + 100 + 75);
    expect(result.totalStake).toBe(175);
  });

  test("0 causes all outside bets except straight:0 to lose", () => {
    const wagers: Wager[] = [
      { area: "red", stake: 100 },
      { area: "black", stake: 100 },
      { area: "odd", stake: 100 },
      { area: "even", stake: 100 },
      { area: "low", stake: 100 },
      { area: "high", stake: 100 },
      { area: "straight:0", stake: 10 },
    ];
    const result = settleRound(wagers, 0);
    const wins = result.breakdown.filter(b => b.won);
    expect(wins.length).toBe(1);
    expect(wins[0].area).toBe("straight:0");
    expect(wins[0].grossPayout).toBe(360);
  });

  test("totalStake sums all wager stakes", () => {
    const wagers: Wager[] = [{ area: "red", stake: 50 }, { area: "black", stake: 30 }];
    const result = settleRound(wagers, 5);
    expect(result.totalStake).toBe(80);
  });
});

// ── Settlement (fee) ──────────────────────────────────────────────────────────
describe("settle integration with roulette", () => {
  test("fee is 10% of profit only on win", () => {
    // Red bet 100, wins → gross 200, profit 100, fee 10, net 190
    const { grossPayoutGzo, profitGzo, feeGzo, netPayoutGzo } = settle(100, 200);
    expect(grossPayoutGzo).toBe(200);
    expect(profitGzo).toBe(100);
    expect(feeGzo).toBe(10);
    expect(netPayoutGzo).toBe(190);
  });

  test("no fee on loss (gross=0)", () => {
    const { profitGzo, feeGzo, netPayoutGzo } = settle(100, 0);
    expect(profitGzo).toBe(-100);
    expect(feeGzo).toBe(0);
    expect(netPayoutGzo).toBe(0);
  });

  test("multi-bet profit fee calculation", () => {
    // stake=175, gross=375, profit=200, fee=20, net=355
    const { profitGzo, feeGzo, netPayoutGzo } = settle(175, 375);
    expect(profitGzo).toBe(200);
    expect(feeGzo).toBe(20);
    expect(netPayoutGzo).toBe(355);
  });
});

// ── computeRouletteNumber determinism ─────────────────────────────────────────
describe("computeRouletteNumber", () => {
  test("is deterministic — same inputs yield same output", () => {
    const a = computeRouletteNumber("seed1", "client1", "roulette:user1", 0);
    const b = computeRouletteNumber("seed1", "client1", "roulette:user1", 0);
    expect(a).toBe(b);
  });

  test("result is in range 0-36", () => {
    for (let i = 0; i < 100; i++) {
      const n = computeRouletteNumber(`server${i}`, `client${i}`, `roulette:u${i}`, i);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(36);
    }
  });

  test("different nonces produce different results (usually)", () => {
    const results = new Set<number>();
    for (let i = 0; i < 50; i++) {
      results.add(computeRouletteNumber("fixedSeed", "fixedClient", "roulette:u", i));
    }
    expect(results.size).toBeGreaterThan(10);
  });

  test("different server seeds produce different results", () => {
    const a = computeRouletteNumber("seed_A", "client", "roulette:u", 0);
    const b = computeRouletteNumber("seed_B", "client", "roulette:u", 0);
    expect(a).not.toBe(b);
  });

  test("public seed includes userId", () => {
    expect(computeRoulettePublicSeed("abc123")).toBe("roulette:abc123");
  });

  test("ROULETTE_VERSION is 1", () => expect(ROULETTE_VERSION).toBe(1));
});
