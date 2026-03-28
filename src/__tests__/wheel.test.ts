/**
 * Wheel game logic tests.
 */

import {
  WHEEL_CONFIGS,
  computeWheelSpin,
  computeWheelGrossPayout,
  stopCenterAngle,
  segmentStartAngle,
  WHEEL_VERSION,
  type WheelRisk,
} from "@/lib/wheel";
import { settle } from "@/lib/settlement";

const SS = "test-server-seed-wheel";
const CS = "test-client-seed";
const NS = 1;

// ─── Config validity ──────────────────────────────────────────────────────────

describe("WHEEL_CONFIGS", () => {
  (["low", "medium", "high"] as WheelRisk[]).forEach((risk) => {
    describe(`${risk} risk`, () => {
      const cfg = WHEEL_CONFIGS[risk];

      test("totalWeight matches sum of segment weights", () => {
        const sum = cfg.segments.reduce((s, sg) => s + sg.weight, 0);
        expect(cfg.totalWeight).toBe(sum);
      });

      test("each segment has unique index 0..n-1", () => {
        const indices = cfg.segments.map((s) => s.index);
        expect(indices).toEqual(Array.from({ length: cfg.segments.length }, (_, i) => i));
      });

      test("all multipliers are non-negative", () => {
        cfg.segments.forEach((s) => expect(s.multiplier).toBeGreaterThanOrEqual(0));
      });

      test("all weights are positive integers", () => {
        cfg.segments.forEach((s) => {
          expect(s.weight).toBeGreaterThan(0);
          expect(Number.isInteger(s.weight)).toBe(true);
        });
      });

      test("EV is a finite positive number", () => {
        const ev = cfg.segments.reduce((sum, s) => sum + (s.weight / cfg.totalWeight) * s.multiplier, 0);
        expect(ev).toBeGreaterThan(0);
        expect(Number.isFinite(ev)).toBe(true);
      });
    });
  });
});

// ─── computeWheelSpin ─────────────────────────────────────────────────────────

describe("computeWheelSpin", () => {
  test("is deterministic", () => {
    const r1 = computeWheelSpin(SS, CS, "wheel:u1", NS, "medium");
    const r2 = computeWheelSpin(SS, CS, "wheel:u1", NS, "medium");
    expect(r1).toEqual(r2);
  });

  test("differs with different server seed", () => {
    const r1 = computeWheelSpin("seed-a", CS, "wheel:u1", NS, "medium");
    const r2 = computeWheelSpin("seed-b", CS, "wheel:u1", NS, "medium");
    expect(r1.stopPosition).not.toBe(r2.stopPosition);
  });

  test("differs with different nonce", () => {
    const r1 = computeWheelSpin(SS, CS, "wheel:u1", 1, "medium");
    const r2 = computeWheelSpin(SS, CS, "wheel:u1", 2, "medium");
    expect(r1.stopPosition).not.toBe(r2.stopPosition);
  });

  test("stopPosition is in [0, totalWeight)", () => {
    const cfg = WHEEL_CONFIGS["medium"];
    for (let nonce = 0; nonce < 20; nonce++) {
      const r = computeWheelSpin(SS, CS, "wheel:u1", nonce, "medium");
      expect(r.stopPosition).toBeGreaterThanOrEqual(0);
      expect(r.stopPosition).toBeLessThan(cfg.totalWeight);
    }
  });

  test("segmentIndex is valid", () => {
    const cfg = WHEEL_CONFIGS["medium"];
    for (let nonce = 0; nonce < 20; nonce++) {
      const r = computeWheelSpin(SS, CS, "wheel:u1", nonce, "medium");
      expect(r.segmentIndex).toBeGreaterThanOrEqual(0);
      expect(r.segmentIndex).toBeLessThan(cfg.segments.length);
    }
  });

  test("segmentLabel matches segment at segmentIndex", () => {
    const cfg = WHEEL_CONFIGS["low"];
    const r = computeWheelSpin(SS, CS, "wheel:u1", NS, "low");
    expect(r.segmentLabel).toBe(cfg.segments[r.segmentIndex].label);
  });

  test("landedMultiplier matches segment", () => {
    const cfg = WHEEL_CONFIGS["high"];
    const r = computeWheelSpin(SS, CS, "wheel:u1", NS, "high");
    expect(r.landedMultiplier).toBe(cfg.segments[r.segmentIndex].multiplier);
  });

  test("works for all risk modes", () => {
    (["low", "medium", "high"] as WheelRisk[]).forEach((risk) => {
      const r = computeWheelSpin(SS, CS, `wheel:u1`, NS, risk);
      const cfg = WHEEL_CONFIGS[risk];
      expect(r.segmentIndex).toBeGreaterThanOrEqual(0);
      expect(r.segmentIndex).toBeLessThan(cfg.segments.length);
    });
  });

  test("distribution roughly matches weights over many spins", () => {
    const cfg = WHEEL_CONFIGS["medium"];
    const counts: Record<number, number> = {};
    const TRIALS = 1000;
    for (let n = 0; n < TRIALS; n++) {
      const r = computeWheelSpin(`server-${n}`, CS, "wheel:u1", 1, "medium");
      counts[r.segmentIndex] = (counts[r.segmentIndex] ?? 0) + 1;
    }
    // Segment 0 (0×, weight 25 out of 54) should appear ~46% of the time
    const seg0Count = counts[0] ?? 0;
    const expectedPct = cfg.segments[0].weight / cfg.totalWeight;
    const actualPct = seg0Count / TRIALS;
    expect(Math.abs(actualPct - expectedPct)).toBeLessThan(0.08); // within 8%
  });
});

// ─── computeWheelGrossPayout ──────────────────────────────────────────────────

describe("computeWheelGrossPayout", () => {
  test("stake × multiplier, floored", () => {
    expect(computeWheelGrossPayout(1000, 2)).toBe(2000);
    expect(computeWheelGrossPayout(1000, 1.5)).toBe(1500);
    expect(computeWheelGrossPayout(333, 3)).toBe(999);
  });

  test("returns 0 for multiplier 0 (loss)", () => {
    expect(computeWheelGrossPayout(500, 0)).toBe(0);
  });

  test("floors fractional results", () => {
    expect(computeWheelGrossPayout(100, 1.2)).toBe(120);
    // 100 × 25 = 2500 (exact)
    expect(computeWheelGrossPayout(100, 25)).toBe(2500);
  });
});

// ─── Fee handling ─────────────────────────────────────────────────────────────

describe("fee handling", () => {
  test("no fee on loss (gross = 0)", () => {
    const { feeGzo, profitGzo, netPayoutGzo } = settle(1000, 0);
    expect(feeGzo).toBe(0);
    expect(profitGzo).toBe(-1000);
    expect(netPayoutGzo).toBe(0);
  });

  test("no fee when gross = stake (push, multiplier 1)", () => {
    const { feeGzo, profitGzo } = settle(1000, 1000);
    expect(feeGzo).toBe(0);
    expect(profitGzo).toBe(0);
  });

  test("fee is 10% of profit on win", () => {
    // stake 1000, multiplier 2 → gross 2000, profit 1000, fee 100
    const { feeGzo, profitGzo, netPayoutGzo, grossPayoutGzo } = settle(1000, 2000);
    expect(grossPayoutGzo).toBe(2000);
    expect(profitGzo).toBe(1000);
    expect(feeGzo).toBe(100);
    expect(netPayoutGzo).toBe(1900);
  });

  test("fee is floored (no fractional GZO)", () => {
    // stake 100, multiplier 1.2 → gross 120, profit 20, fee = floor(2) = 2
    const { feeGzo } = settle(100, 120);
    expect(feeGzo).toBe(2);
  });
});

// ─── Geometry helpers ─────────────────────────────────────────────────────────

describe("stopCenterAngle", () => {
  test("stop 0 of 54 → just above 0°", () => {
    const angle = stopCenterAngle(0, 54);
    expect(angle).toBeCloseTo((0.5 / 54) * 360, 3);
  });

  test("stop at halfway → 180°", () => {
    const angle = stopCenterAngle(27, 54);
    expect(angle).toBeCloseTo(183.33, 1);
  });

  test("always in [0, 360)", () => {
    for (let i = 0; i < 54; i++) {
      const a = stopCenterAngle(i, 54);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(360);
    }
  });
});

describe("segmentStartAngle", () => {
  test("first segment starts at 0°", () => {
    expect(segmentStartAngle(0, WHEEL_CONFIGS["medium"])).toBe(0);
  });

  test("second segment starts where first ends", () => {
    const cfg = WHEEL_CONFIGS["medium"];
    const expected = (cfg.segments[0].weight / cfg.totalWeight) * 360;
    expect(segmentStartAngle(1, cfg)).toBeCloseTo(expected, 5);
  });
});

// ─── WHEEL_VERSION ────────────────────────────────────────────────────────────

describe("WHEEL_VERSION", () => {
  test("is 1", () => {
    expect(WHEEL_VERSION).toBe(1);
  });
});
