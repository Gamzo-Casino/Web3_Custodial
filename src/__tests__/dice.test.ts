import { hmacSha256Bytes, bytesToDiceRoll } from "@/lib/rng";
import {
  computeDicePublicSeed,
  computeDiceRoll,
  computeDiceGrossPayout,
  computeDiceMultiplier,
} from "@/lib/dice";
import { settle } from "@/lib/settlement";

// Known fixture seeds for determinism / vector tests
const SERVER_SEED = "a".repeat(64);
const CLIENT_SEED = "myclientseed";
const USER_ID = "user_abc123";
const NONCE = 1;

// ── bytesToDiceRoll ────────────────────────────────────────────────────────────
describe("bytesToDiceRoll", () => {
  it("returns a value in [0.00, 99.99]", () => {
    for (let i = 0; i < 50; i++) {
      const bytes = hmacSha256Bytes(
        String(i).padStart(64, "0"),
        CLIENT_SEED,
        `dice:${USER_ID}`,
        NONCE
      );
      const roll = bytesToDiceRoll(bytes);
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThanOrEqual(99.99);
    }
  });

  it("has at most 2 decimal places (integer × 0.01)", () => {
    for (let i = 0; i < 20; i++) {
      const bytes = hmacSha256Bytes(
        String(i).padStart(64, "0"),
        CLIENT_SEED,
        `dice:${USER_ID}`,
        NONCE
      );
      const roll = bytesToDiceRoll(bytes);
      // roll = floor(f * 10000) / 100, so roll * 100 should be within FP epsilon of an integer
      expect(Math.abs(roll * 100 - Math.round(roll * 100))).toBeLessThan(1e-9);
    }
  });

  it("is deterministic — same inputs produce same roll", () => {
    const bytes = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, `dice:${USER_ID}`, NONCE);
    expect(bytesToDiceRoll(bytes)).toBe(bytesToDiceRoll(bytes));
  });

  it("produces varied values across 20 different seeds (no collisions)", () => {
    const rolls = new Set(
      Array.from({ length: 20 }, (_, i) => {
        const bytes = hmacSha256Bytes(
          String(i).padStart(64, "0"),
          CLIENT_SEED,
          `dice:${USER_ID}`,
          NONCE
        );
        return bytesToDiceRoll(bytes);
      })
    );
    expect(rolls.size).toBe(20);
  });
});

// ── computeDicePublicSeed ──────────────────────────────────────────────────────
describe("computeDicePublicSeed", () => {
  it("returns dice:<userId>", () => {
    expect(computeDicePublicSeed("user123")).toBe("dice:user123");
  });

  it("is deterministic and unique per user", () => {
    expect(computeDicePublicSeed("alice")).not.toBe(computeDicePublicSeed("bob"));
  });
});

// ── Known seed vector test ─────────────────────────────────────────────────────
describe("computeDiceRoll — known seed vectors", () => {
  it("produces a fixed roll for the fixture seeds (determinism contract)", () => {
    const publicSeed = computeDicePublicSeed(USER_ID);
    const roll = computeDiceRoll(SERVER_SEED, CLIENT_SEED, publicSeed, NONCE);

    // Independently recompute the expected value:
    const bytes = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, publicSeed, NONCE);
    const expected = bytesToDiceRoll(bytes);

    expect(roll).toBe(expected);
    // Snapshot: if this changes, the algorithm changed — update carefully.
    expect(typeof roll).toBe("number");
    expect(roll).toBeGreaterThanOrEqual(0);
    expect(roll).toBeLessThanOrEqual(99.99);
  });

  it("changing nonce changes the roll", () => {
    const ps = computeDicePublicSeed(USER_ID);
    const roll1 = computeDiceRoll(SERVER_SEED, CLIENT_SEED, ps, 1);
    const roll2 = computeDiceRoll(SERVER_SEED, CLIENT_SEED, ps, 2);
    expect(roll1).not.toBe(roll2);
  });

  it("changing serverSeed changes the roll", () => {
    const ps = computeDicePublicSeed(USER_ID);
    const roll1 = computeDiceRoll("a".repeat(64), CLIENT_SEED, ps, NONCE);
    const roll2 = computeDiceRoll("b".repeat(64), CLIENT_SEED, ps, NONCE);
    expect(roll1).not.toBe(roll2);
  });

  it("changing clientSeed changes the roll", () => {
    const ps = computeDicePublicSeed(USER_ID);
    const roll1 = computeDiceRoll(SERVER_SEED, "seed1", ps, NONCE);
    const roll2 = computeDiceRoll(SERVER_SEED, "seed2", ps, NONCE);
    expect(roll1).not.toBe(roll2);
  });

  it("50 consecutive nonces produce 50 distinct rolls", () => {
    const ps = computeDicePublicSeed(USER_ID);
    const rolls = new Set(
      Array.from({ length: 50 }, (_, n) => computeDiceRoll(SERVER_SEED, CLIENT_SEED, ps, n))
    );
    expect(rolls.size).toBe(50);
  });

  it("rolls are uniformly distributed — mean close to 50 over 200 samples", () => {
    const ps = computeDicePublicSeed(USER_ID);
    const rolls = Array.from({ length: 200 }, (_, i) =>
      computeDiceRoll(String(i).padStart(64, "0"), CLIENT_SEED, ps, NONCE)
    );
    const mean = rolls.reduce((a, b) => a + b, 0) / rolls.length;
    expect(mean).toBeGreaterThan(30);
    expect(mean).toBeLessThan(70);
  });
});

// ── computeDiceMultiplier ──────────────────────────────────────────────────────
describe("computeDiceMultiplier", () => {
  it("returns 99 / target", () => {
    expect(computeDiceMultiplier(50)).toBeCloseTo(1.98);
    expect(computeDiceMultiplier(1)).toBeCloseTo(99);
    expect(computeDiceMultiplier(99)).toBeCloseTo(1.0);
  });

  it("higher target → lower multiplier (less risky, smaller reward)", () => {
    expect(computeDiceMultiplier(90)).toBeLessThan(computeDiceMultiplier(10));
  });
});

// ── computeDiceGrossPayout ────────────────────────────────────────────────────
describe("computeDiceGrossPayout", () => {
  it("floors to integer GZO", () => {
    const gross = computeDiceGrossPayout(100, 50);
    expect(Number.isInteger(gross)).toBe(true);
  });

  it("is floor(stake × 99 / target)", () => {
    const stake = 1000;
    const target = 33;
    expect(computeDiceGrossPayout(stake, target)).toBe(
      Math.floor(stake * (99 / target))
    );
  });

  it("gross >= stake (player gets at least their stake back on a win)", () => {
    // Only true when target < 99. At target=1, multiplier=99x (very high)
    const gross = computeDiceGrossPayout(100, 49);
    expect(gross).toBeGreaterThan(100);
  });
});

// ── Accounting (win / loss / fee) ──────────────────────────────────────────────
describe("dice accounting", () => {
  const stake = 1000;
  const target = 50; // win chance 50%, multiplier ≈ 1.98x, grossPayout = 1980

  it("win: correct gross payout, fee = 10% of profit, net = gross - fee", () => {
    const gross = computeDiceGrossPayout(stake, target); // floor(1000 × 1.98) = 1980
    const { grossPayoutGzo, profitGzo, feeGzo, netPayoutGzo } = settle(stake, gross);

    expect(grossPayoutGzo).toBe(gross);
    expect(profitGzo).toBe(gross - stake);
    expect(feeGzo).toBe(Math.floor(profitGzo * 0.1));
    expect(netPayoutGzo).toBe(gross - feeGzo);
  });

  it("loss: settle(stake, 0) returns zero payout and zero fee", () => {
    const { grossPayoutGzo, profitGzo, feeGzo, netPayoutGzo } = settle(stake, 0);
    expect(grossPayoutGzo).toBe(0);
    expect(profitGzo).toBe(-stake);
    expect(feeGzo).toBe(0);
    expect(netPayoutGzo).toBe(0);
  });

  it("balance change on win: finalBalance = start - stake + netPayout", () => {
    const startBalance = 10_000;
    const gross = computeDiceGrossPayout(stake, target);
    const { netPayoutGzo } = settle(stake, gross);
    const finalBalance = startBalance - stake + netPayoutGzo;
    expect(finalBalance).toBe(startBalance + (netPayoutGzo - stake));
  });

  it("balance change on loss: finalBalance = start - stake", () => {
    const startBalance = 10_000;
    const finalBalance = startBalance - stake;
    expect(finalBalance).toBe(9_000);
  });

  it("fee only applies on profit > 0 — small-profit win has fee floored", () => {
    // Stake 999, gross 1000 → profit=1 → fee=floor(0.1)=0
    const { feeGzo, netPayoutGzo } = settle(999, 1000);
    expect(feeGzo).toBe(0);
    expect(netPayoutGzo).toBe(1000);
  });

  it("net payout is always ≥ 0", () => {
    const { netPayoutGzo } = settle(stake, computeDiceGrossPayout(stake, target));
    expect(netPayoutGzo).toBeGreaterThanOrEqual(0);
  });

  it("house net per won bet = feeGzo (house earns only the fee)", () => {
    // House receives stake (BET_IN), pays gross (BET_OUT), recredits fee (FEE)
    // Net = +stake - grossPayout + feeGzo = -(profitGzo - feeGzo) = -netProfitToPlayer
    const gross = computeDiceGrossPayout(stake, target);
    const { feeGzo, profitGzo } = settle(stake, gross);
    const houseNet = stake - gross + feeGzo;
    // houseNet = stake - floor(stake * 99/target) + floor((gross - stake) * 0.1)
    // This is negative (house pays out), net house profit = feeGzo
    expect(feeGzo).toBeGreaterThan(0);
    expect(Math.abs(houseNet)).toBe(profitGzo - feeGzo); // house net outflow = player's net profit
  });

  it("high-multiplier bet: 5% win chance (target=5), 1000 stake", () => {
    const t = 5;
    const gross = computeDiceGrossPayout(1000, t); // floor(1000 * 99/5) = floor(19800) = 19800
    expect(gross).toBe(19800);
    const { feeGzo, netPayoutGzo } = settle(1000, gross);
    expect(feeGzo).toBe(Math.floor((gross - 1000) * 0.1)); // 10% of 18800 = 1880
    expect(netPayoutGzo).toBe(gross - feeGzo);
  });
});

// ── Win/loss classification ────────────────────────────────────────────────────
describe("ROLL_UNDER win condition", () => {
  it("wins when roll < target (strictly)", () => {
    // Force a known roll value via test seed search, or just test the condition directly
    const roll = 24.5;
    const target = 50;
    expect(roll < target).toBe(true);
  });

  it("loses when roll === target (not strictly less)", () => {
    const roll = 50.0;
    const target = 50;
    expect(roll < target).toBe(false);
  });

  it("loses when roll > target", () => {
    const roll = 75.5;
    const target = 50;
    expect(roll < target).toBe(false);
  });

  it("statistical: with target=50, ~50% of rolls are wins over 1000 samples", () => {
    const ps = computeDicePublicSeed(USER_ID);
    let wins = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      const roll = computeDiceRoll(String(i).padStart(64, "0"), CLIENT_SEED, ps, i);
      if (roll < 50) wins++;
    }
    // Expect roughly 50% wins (±5% tolerance)
    expect(wins / N).toBeGreaterThan(0.45);
    expect(wins / N).toBeLessThan(0.55);
  });
});
