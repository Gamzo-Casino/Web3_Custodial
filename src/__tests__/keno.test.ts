import { bytesToKenoDraw, hmacSha256Bytes, RNG_VERSION } from "@/lib/rng";
import {
  computeKenoDraw,
  computeKenoMatches,
  computeKenoMultiplier,
  computeKenoGrossPayout,
  computeKenoPublicSeed,
  KENO_PAYTABLE,
  KENO_MIN_PICKS,
  KENO_MAX_PICKS,
  KENO_NUMBERS,
  KENO_DRAWN,
} from "@/lib/keno";
import { settle } from "@/lib/settlement";

// ── bytesToKenoDraw ───────────────────────────────────────────────────────────

describe("bytesToKenoDraw", () => {
  function makeBytes(seed = 0): Buffer {
    // 96 bytes for the draw (Fisher-Yates needs 78)
    const b = Buffer.alloc(96, seed);
    // Write some variety
    for (let i = 0; i < 96; i++) b[i] = (seed + i * 37) & 0xff;
    return b;
  }

  it("returns exactly 10 numbers", () => {
    expect(bytesToKenoDraw(makeBytes(1))).toHaveLength(10);
  });

  it("all numbers are in range [1, 40]", () => {
    const drawn = bytesToKenoDraw(makeBytes(42));
    drawn.forEach((n) => {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(40);
    });
  });

  it("all 10 drawn numbers are unique", () => {
    const drawn = bytesToKenoDraw(makeBytes(7));
    expect(new Set(drawn).size).toBe(10);
  });

  it("is deterministic — same bytes → same draw", () => {
    const bytes = makeBytes(99);
    expect(bytesToKenoDraw(bytes)).toEqual(bytesToKenoDraw(bytes));
  });

  it("different bytes produce different draws", () => {
    const a = bytesToKenoDraw(makeBytes(1));
    const b = bytesToKenoDraw(makeBytes(200));
    expect(a).not.toEqual(b);
  });

  it("returns numbers sorted ascending", () => {
    const drawn = bytesToKenoDraw(makeBytes(55));
    for (let i = 1; i < drawn.length; i++) {
      expect(drawn[i]).toBeGreaterThan(drawn[i - 1]);
    }
  });

  it("uniqueness holds over many random-ish byte sets", () => {
    for (let seed = 0; seed < 200; seed++) {
      const drawn = bytesToKenoDraw(makeBytes(seed));
      expect(new Set(drawn).size).toBe(10);
    }
  });

  it("all 40 numbers appear roughly uniformly over many draws", () => {
    const counts = new Array(41).fill(0);
    const N = 500;
    for (let i = 0; i < N; i++) {
      const bytes = Buffer.concat([
        hmacSha256Bytes("s", "c", "p", i),
        hmacSha256Bytes("s", "c", "p:1", i),
        hmacSha256Bytes("s", "c", "p:2", i),
      ]);
      bytesToKenoDraw(bytes).forEach((n) => counts[n]++);
    }
    // Each number should appear ~500×10/40 = 125 times. Allow ±60 (3 sigma ≈ ±28).
    for (let n = 1; n <= 40; n++) {
      expect(counts[n]).toBeGreaterThan(60);
      expect(counts[n]).toBeLessThan(200);
    }
  });
});

// ── computeKenoPublicSeed ─────────────────────────────────────────────────────

describe("computeKenoPublicSeed", () => {
  it("has correct format", () => {
    expect(computeKenoPublicSeed("user1")).toBe("keno:user1");
  });

  it("is unique per user", () => {
    expect(computeKenoPublicSeed("a")).not.toBe(computeKenoPublicSeed("b"));
  });
});

// ── computeKenoDraw ───────────────────────────────────────────────────────────

describe("computeKenoDraw", () => {
  const SS = "serverSeedAlpha";
  const CS = "clientSeedBeta";
  const PS = computeKenoPublicSeed("testuser");

  it("is deterministic", () => {
    const a = computeKenoDraw(SS, CS, PS, 0);
    const b = computeKenoDraw(SS, CS, PS, 0);
    expect(a).toEqual(b);
  });

  it("returns exactly 10 unique numbers in [1,40]", () => {
    const drawn = computeKenoDraw(SS, CS, PS, 5);
    expect(drawn).toHaveLength(10);
    expect(new Set(drawn).size).toBe(10);
    drawn.forEach((n) => {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(40);
    });
  });

  it("changes when nonce changes", () => {
    const a = computeKenoDraw(SS, CS, PS, 0);
    const b = computeKenoDraw(SS, CS, PS, 1);
    expect(a).not.toEqual(b);
  });

  it("changes when serverSeed changes", () => {
    const a = computeKenoDraw(SS, CS, PS, 3);
    const b = computeKenoDraw("different", CS, PS, 3);
    expect(a).not.toEqual(b);
  });

  it("changes when clientSeed changes", () => {
    const a = computeKenoDraw(SS, CS, PS, 3);
    const b = computeKenoDraw(SS, "other", PS, 3);
    expect(a).not.toEqual(b);
  });

  it("uniqueness guaranteed over 100 sequential nonces", () => {
    for (let n = 0; n < 100; n++) {
      const drawn = computeKenoDraw(SS, CS, PS, n);
      expect(new Set(drawn).size).toBe(10);
    }
  });
});

// ── computeKenoMatches ────────────────────────────────────────────────────────

describe("computeKenoMatches", () => {
  it("returns 0 when no overlap", () => {
    expect(computeKenoMatches([1, 2, 3], [4, 5, 6, 7, 8, 9, 10, 11, 12, 13])).toBe(0);
  });

  it("returns correct match count", () => {
    expect(computeKenoMatches([1, 2, 3, 4], [1, 2, 5, 6, 7, 8, 9, 10, 11, 12])).toBe(2);
  });

  it("returns picks.length when all match", () => {
    expect(computeKenoMatches([1, 2, 3], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(3);
  });

  it("handles single pick hit", () => {
    expect(computeKenoMatches([7], [7, 8, 9, 10, 11, 12, 13, 14, 15, 16])).toBe(1);
  });

  it("handles single pick miss", () => {
    expect(computeKenoMatches([40], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(0);
  });
});

// ── computeKenoMultiplier ─────────────────────────────────────────────────────

describe("computeKenoMultiplier", () => {
  it("picks=1, match=1 → 3.5", () => {
    expect(computeKenoMultiplier(1, 1)).toBe(3.5);
  });

  it("picks=1, match=0 → 0", () => {
    expect(computeKenoMultiplier(1, 0)).toBe(0);
  });

  it("picks=10, match=10 → 10000", () => {
    expect(computeKenoMultiplier(10, 10)).toBe(10000);
  });

  it("picks=10, match=0 → 5 (rare bonus)", () => {
    expect(computeKenoMultiplier(10, 0)).toBe(5);
  });

  it("picks=5, match=5 → 100", () => {
    expect(computeKenoMultiplier(5, 5)).toBe(100);
  });

  it("returns 0 for out-of-paytable match", () => {
    expect(computeKenoMultiplier(3, 0)).toBe(0);
  });

  it("returns 0 for unknown picks count", () => {
    expect(computeKenoMultiplier(0, 0)).toBe(0);
  });
});

// ── computeKenoGrossPayout ────────────────────────────────────────────────────

describe("computeKenoGrossPayout", () => {
  it("floors stake × multiplier", () => {
    expect(computeKenoGrossPayout(100, 3.5)).toBe(350);
  });

  it("returns 0 when multiplier = 0", () => {
    expect(computeKenoGrossPayout(500, 0)).toBe(0);
  });

  it("floors fractional result", () => {
    expect(computeKenoGrossPayout(7, 1.5)).toBe(10);
  });

  it("handles large multiplier", () => {
    expect(computeKenoGrossPayout(100, 10000)).toBe(1_000_000);
  });

  it("always returns integer", () => {
    expect(Number.isInteger(computeKenoGrossPayout(333, 7))).toBe(true);
  });
});

// ── KENO_PAYTABLE structure ───────────────────────────────────────────────────

describe("KENO_PAYTABLE structure", () => {
  it("covers all pick counts 1–10", () => {
    for (let p = 1; p <= 10; p++) {
      expect(KENO_PAYTABLE[p]).toBeDefined();
    }
  });

  it("each row has exactly picks+1 entries (0 matches to picks matches)", () => {
    for (let p = 1; p <= 10; p++) {
      expect(KENO_PAYTABLE[p]).toHaveLength(p + 1);
    }
  });

  it("all multipliers are non-negative", () => {
    for (let p = 1; p <= 10; p++) {
      KENO_PAYTABLE[p].forEach((m) => expect(m).toBeGreaterThanOrEqual(0));
    }
  });

  it("maximum multiplier for picks=10 is 10000", () => {
    expect(Math.max(...KENO_PAYTABLE[10])).toBe(10000);
  });
});

// ── Keno accounting ───────────────────────────────────────────────────────────

describe("Keno accounting", () => {
  it("win: gross = floor(stake × mult), fee on profit, net = gross - fee", () => {
    const stake = 100;
    const multiplier = 7; // e.g., 2-pick, 2-match
    const gross = computeKenoGrossPayout(stake, multiplier); // 700
    const { profitGzo, feeGzo, netPayoutGzo } = settle(stake, gross);
    expect(gross).toBe(700);
    expect(profitGzo).toBe(600);
    expect(feeGzo).toBe(60);
    expect(netPayoutGzo).toBe(640);
  });

  it("loss: gross = 0, no fee, net = 0", () => {
    const { profitGzo, feeGzo, netPayoutGzo } = settle(100, 0);
    expect(profitGzo).toBe(-100);
    expect(feeGzo).toBe(0);
    expect(netPayoutGzo).toBe(0);
  });

  it("balance decreases on loss", () => {
    const stake = 200;
    const { netPayoutGzo } = settle(stake, 0);
    const balanceBefore = 1000;
    expect(balanceBefore - stake + netPayoutGzo).toBe(800);
  });

  it("balance increases on win", () => {
    const stake = 100;
    const gross = computeKenoGrossPayout(stake, 7);
    const { netPayoutGzo } = settle(stake, gross);
    const balanceBefore = 1000;
    // 1000 - 100 + 640 = 1540
    expect(balanceBefore - stake + netPayoutGzo).toBe(1540);
  });
});

// ── Constants ─────────────────────────────────────────────────────────────────

describe("Keno constants", () => {
  it("KENO_NUMBERS is 40", () => expect(KENO_NUMBERS).toBe(40));
  it("KENO_DRAWN is 10",   () => expect(KENO_DRAWN).toBe(10));
  it("KENO_MIN_PICKS is 1", () => expect(KENO_MIN_PICKS).toBe(1));
  it("KENO_MAX_PICKS is 10", () => expect(KENO_MAX_PICKS).toBe(10));
  it("RNG_VERSION is 1", () => expect(RNG_VERSION).toBe(1));
});
