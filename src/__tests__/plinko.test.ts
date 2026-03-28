import { hmacSha256Bytes, bytesToPlinkoPath } from "@/lib/rng";
import {
  computePlinkoPublicSeed,
  computePlinkoPath,
  computePlinkoBinIndex,
  computePlinkoMultiplier,
  computePlinkoGrossPayout,
  PLINKO_MULTIPLIERS,
  PLINKO_ROWS,
  PLINKO_RISKS,
  type PlinkoRows,
  type PlinkoRisk,
} from "@/lib/plinko";
import { settle } from "@/lib/settlement";

const SERVER_SEED = "a".repeat(64);
const CLIENT_SEED = "myclientseed";
const USER_ID = "user_plinko_test";
const NONCE = 1;

// ── bytesToPlinkoPath ──────────────────────────────────────────────────────────
describe("bytesToPlinkoPath", () => {
  it("returns exactly `rows` booleans", () => {
    for (const rows of PLINKO_ROWS) {
      const bytes = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, `plinko:${USER_ID}`, NONCE);
      const path = bytesToPlinkoPath(bytes, rows);
      expect(path).toHaveLength(rows);
    }
  });

  it("contains only booleans", () => {
    const bytes = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, `plinko:${USER_ID}`, NONCE);
    const path = bytesToPlinkoPath(bytes, 16);
    path.forEach((v) => expect(typeof v).toBe("boolean"));
  });

  it("is deterministic — same inputs produce same path", () => {
    const bytes = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, `plinko:${USER_ID}`, NONCE);
    expect(bytesToPlinkoPath(bytes, 12)).toEqual(bytesToPlinkoPath(bytes, 12));
  });

  it("different server seeds produce varied paths (≥ 15 distinct out of 20)", () => {
    // 8-row paths have 2^8 = 256 combos; birthday collisions are expected in small samples
    const rows = 8;
    const paths = new Set(
      Array.from({ length: 20 }, (_, i) => {
        const bytes = hmacSha256Bytes(
          String(i).padStart(64, "0"),
          CLIENT_SEED,
          `plinko:${USER_ID}`,
          NONCE
        );
        return bytesToPlinkoPath(bytes, rows).join(",");
      })
    );
    expect(paths.size).toBeGreaterThanOrEqual(15);
  });

  it("bin index (right count) is in [0, rows]", () => {
    for (const rows of PLINKO_ROWS) {
      for (let i = 0; i < 20; i++) {
        const bytes = hmacSha256Bytes(
          String(i).padStart(64, "0"),
          CLIENT_SEED,
          `plinko:${USER_ID}`,
          NONCE
        );
        const path = bytesToPlinkoPath(bytes, rows);
        const bin = path.filter(Boolean).length;
        expect(bin).toBeGreaterThanOrEqual(0);
        expect(bin).toBeLessThanOrEqual(rows);
      }
    }
  });
});

// ── computePlinkoPublicSeed ────────────────────────────────────────────────────
describe("computePlinkoPublicSeed", () => {
  it("returns plinko:<userId>", () => {
    expect(computePlinkoPublicSeed("alice")).toBe("plinko:alice");
  });

  it("is unique per user", () => {
    expect(computePlinkoPublicSeed("alice")).not.toBe(computePlinkoPublicSeed("bob"));
  });
});

// ── computePlinkoPath — determinism ───────────────────────────────────────────
describe("computePlinkoPath — determinism", () => {
  it("produces a fixed path for fixture seeds", () => {
    const ps = computePlinkoPublicSeed(USER_ID);
    const path1 = computePlinkoPath(SERVER_SEED, CLIENT_SEED, ps, NONCE, 8);
    const path2 = computePlinkoPath(SERVER_SEED, CLIENT_SEED, ps, NONCE, 8);
    expect(path1).toEqual(path2);
  });

  it("changing nonce changes the path", () => {
    const ps = computePlinkoPublicSeed(USER_ID);
    const path1 = computePlinkoPath(SERVER_SEED, CLIENT_SEED, ps, 1, 8);
    const path2 = computePlinkoPath(SERVER_SEED, CLIENT_SEED, ps, 2, 8);
    expect(path1).not.toEqual(path2);
  });

  it("changing serverSeed changes the path", () => {
    const ps = computePlinkoPublicSeed(USER_ID);
    const path1 = computePlinkoPath("a".repeat(64), CLIENT_SEED, ps, NONCE, 12);
    const path2 = computePlinkoPath("b".repeat(64), CLIENT_SEED, ps, NONCE, 12);
    expect(path1).not.toEqual(path2);
  });

  it("changing clientSeed changes the path", () => {
    const ps = computePlinkoPublicSeed(USER_ID);
    const path1 = computePlinkoPath(SERVER_SEED, "seed1", ps, NONCE, 12);
    const path2 = computePlinkoPath(SERVER_SEED, "seed2", ps, NONCE, 12);
    expect(path1).not.toEqual(path2);
  });

  it("50 consecutive nonces produce ≥ 40 distinct paths (16 rows, 2^16 space)", () => {
    // Use 16 rows (65536 combos) to avoid birthday collisions with 50 samples
    const ps = computePlinkoPublicSeed(USER_ID);
    const paths = new Set(
      Array.from({ length: 50 }, (_, n) =>
        computePlinkoPath(SERVER_SEED, CLIENT_SEED, ps, n, 16).join(",")
      )
    );
    expect(paths.size).toBeGreaterThanOrEqual(40);
  });
});

// ── computePlinkoBinIndex ──────────────────────────────────────────────────────
describe("computePlinkoBinIndex", () => {
  it("all left = bin 0", () => {
    expect(computePlinkoBinIndex([false, false, false, false])).toBe(0);
  });

  it("all right = bin rows", () => {
    expect(computePlinkoBinIndex([true, true, true, true, true, true, true, true])).toBe(8);
  });

  it("alternating = rows / 2", () => {
    expect(computePlinkoBinIndex([true, false, true, false, true, false, true, false])).toBe(4);
  });

  it("is in [0, rows] for any random path", () => {
    const ps = computePlinkoPublicSeed(USER_ID);
    for (const rows of PLINKO_ROWS) {
      for (let i = 0; i < 30; i++) {
        const path = computePlinkoPath(
          String(i).padStart(64, "0"),
          CLIENT_SEED,
          ps,
          i,
          rows as PlinkoRows
        );
        const bin = computePlinkoBinIndex(path);
        expect(bin).toBeGreaterThanOrEqual(0);
        expect(bin).toBeLessThanOrEqual(rows);
      }
    }
  });
});

// ── Multiplier tables ─────────────────────────────────────────────────────────
describe("PLINKO_MULTIPLIERS table structure", () => {
  it("has rows × risks × (rows+1) bins", () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of PLINKO_RISKS) {
        expect(PLINKO_MULTIPLIERS[rows][risk]).toHaveLength(rows + 1);
      }
    }
  });

  it("all multipliers are positive numbers", () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of PLINKO_RISKS) {
        PLINKO_MULTIPLIERS[rows][risk].forEach((m) => {
          expect(typeof m).toBe("number");
          expect(m).toBeGreaterThan(0);
        });
      }
    }
  });

  it("tables are symmetric (bin[i] === bin[rows-i])", () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of PLINKO_RISKS) {
        const table = PLINKO_MULTIPLIERS[rows][risk];
        for (let i = 0; i <= rows; i++) {
          expect(table[i]).toBe(table[rows - i]);
        }
      }
    }
  });

  it("high risk has larger edge multipliers than low risk (bin 0)", () => {
    for (const rows of PLINKO_ROWS) {
      expect(PLINKO_MULTIPLIERS[rows]["high"][0]).toBeGreaterThan(
        PLINKO_MULTIPLIERS[rows]["low"][0]
      );
    }
  });

  it("high risk has lower center multiplier than low risk (more polarized)", () => {
    for (const rows of PLINKO_ROWS) {
      const center = Math.floor(rows / 2);
      expect(PLINKO_MULTIPLIERS[rows]["high"][center]).toBeLessThan(
        PLINKO_MULTIPLIERS[rows]["low"][center]
      );
    }
  });
});

// ── computePlinkoMultiplier ────────────────────────────────────────────────────
describe("computePlinkoMultiplier", () => {
  it("looks up the correct table entry", () => {
    expect(computePlinkoMultiplier(8, "low", 0)).toBe(PLINKO_MULTIPLIERS[8]["low"][0]);
    expect(computePlinkoMultiplier(12, "high", 6)).toBe(PLINKO_MULTIPLIERS[12]["high"][6]);
    expect(computePlinkoMultiplier(16, "med", 8)).toBe(PLINKO_MULTIPLIERS[16]["med"][8]);
  });
});

// ── computePlinkoGrossPayout ───────────────────────────────────────────────────
describe("computePlinkoGrossPayout", () => {
  it("is floor(stake × multiplier)", () => {
    expect(computePlinkoGrossPayout(1000, 1.98)).toBe(Math.floor(1000 * 1.98));
  });

  it("returns integer GZO", () => {
    expect(Number.isInteger(computePlinkoGrossPayout(777, 2.5))).toBe(true);
  });

  it("high-multiplier bin: 1000 stake × 29× = 29000", () => {
    expect(computePlinkoGrossPayout(1000, 29)).toBe(29000);
  });

  it("sub-1 multiplier: gross < stake", () => {
    expect(computePlinkoGrossPayout(1000, 0.2)).toBeLessThan(1000);
  });
});

// ── Accounting ────────────────────────────────────────────────────────────────
describe("Plinko accounting", () => {
  const stake = 1000;

  it("win: correct gross, fee = 10% of profit, net = gross - fee", () => {
    const gross = computePlinkoGrossPayout(stake, 5.6); // 5600
    const { grossPayoutGzo, profitGzo, feeGzo, netPayoutGzo } = settle(stake, gross);
    expect(grossPayoutGzo).toBe(gross);
    expect(profitGzo).toBe(gross - stake);
    expect(feeGzo).toBe(Math.floor(profitGzo * 0.1));
    expect(netPayoutGzo).toBe(gross - feeGzo);
  });

  it("loss (sub-1 multiplier): settle returns 0 fee", () => {
    const gross = computePlinkoGrossPayout(stake, 0.2); // 200, loss
    const { profitGzo, feeGzo, netPayoutGzo } = settle(stake, gross);
    expect(profitGzo).toBeLessThan(0);
    expect(feeGzo).toBe(0);
    expect(netPayoutGzo).toBe(gross);
  });

  it("1× multiplier edge: gross === stake → profit = 0 → fee = 0", () => {
    const gross = computePlinkoGrossPayout(stake, 1.0); // exactly 1000
    const { profitGzo, feeGzo, netPayoutGzo } = settle(stake, gross);
    expect(profitGzo).toBe(0);
    expect(feeGzo).toBe(0);
    expect(netPayoutGzo).toBe(gross);
  });

  it("balance change on win: finalBalance = start - stake + netPayout", () => {
    const startBalance = 50_000;
    const gross = computePlinkoGrossPayout(stake, 13); // 13000
    const { netPayoutGzo } = settle(stake, gross);
    const finalBalance = startBalance - stake + netPayoutGzo;
    expect(finalBalance).toBe(startBalance + (netPayoutGzo - stake));
  });

  it("net payout is always >= 0", () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of PLINKO_RISKS) {
        for (let bin = 0; bin <= rows; bin++) {
          const m = computePlinkoMultiplier(rows as PlinkoRows, risk as PlinkoRisk, bin);
          const gross = computePlinkoGrossPayout(stake, m);
          const { netPayoutGzo } = settle(stake, gross);
          expect(netPayoutGzo).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

// ── Statistical distribution ───────────────────────────────────────────────────
describe("bin distribution — statistical", () => {
  it("8-row bin index distribution is roughly binomial (mean ≈ 4 over 500 samples)", () => {
    const rows: PlinkoRows = 8;
    const ps = computePlinkoPublicSeed(USER_ID);
    const bins = Array.from({ length: 500 }, (_, i) => {
      const path = computePlinkoPath(
        String(i).padStart(64, "0"),
        CLIENT_SEED,
        ps,
        i,
        rows
      );
      return computePlinkoBinIndex(path);
    });
    const mean = bins.reduce((a, b) => a + b, 0) / bins.length;
    expect(mean).toBeGreaterThan(3);
    expect(mean).toBeLessThan(5);
  });

  it("no single bin dominates excessively over 200 samples (max frequency ≤ 35%)", () => {
    // 8-row binomial: center bin (bin 4) has P = C(8,4)/2^8 ≈ 27.3%, so 25% is too tight
    const rows: PlinkoRows = 8;
    const ps = computePlinkoPublicSeed(USER_ID);
    const counts = new Array(rows + 1).fill(0);
    const N = 200;
    for (let i = 0; i < N; i++) {
      const path = computePlinkoPath(
        String(i).padStart(64, "0"),
        CLIENT_SEED,
        ps,
        i,
        rows
      );
      counts[computePlinkoBinIndex(path)]++;
    }
    const maxFreq = Math.max(...counts) / N;
    expect(maxFreq).toBeLessThanOrEqual(0.35);
  });
});
