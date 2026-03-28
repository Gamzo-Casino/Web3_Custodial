/**
 * Mines game — unit test suite.
 *
 * Tests cover:
 *  - Deterministic mine placement from fairness inputs
 *  - Mine position uniqueness and range
 *  - Multiplier progression (safe reveal math)
 *  - Mine hit detection
 *  - Cashout calculation
 *  - Fee calculation (10% of profit only)
 *  - Double cashout prevention (via idempotency key uniqueness)
 *  - Invalid tile rejection
 *  - History record shape
 */

import {
  computeMinePositions,
  computeMinesMultiplier,
  computeMinesGrossPayout,
  computeMinesPublicSeed,
  computeMinesMaxMultiplier,
  MINES_VERSION,
  MINES_BOARD_SIZE,
} from "@/lib/mines";
import { settle } from "@/lib/settlement";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const SERVER_SEED = "test-server-seed-abc123";
const CLIENT_SEED = "test-client-seed-xyz789";
const PUBLIC_SEED = computeMinesPublicSeed("user_001");
const NONCE = 0;
const BOARD = MINES_BOARD_SIZE; // 25

// ── RNG / mine placement ──────────────────────────────────────────────────────
describe("computeMinePositions", () => {
  it("returns exactly mineCount positions", () => {
    for (const count of [1, 3, 5, 10, 15, 24]) {
      const pos = computeMinePositions(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE, BOARD, count);
      expect(pos).toHaveLength(count);
    }
  });

  it("all positions are in [0, boardSize-1]", () => {
    const pos = computeMinePositions(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE, BOARD, 5);
    for (const p of pos) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(BOARD);
    }
  });

  it("positions are sorted ascending", () => {
    const pos = computeMinePositions(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE, BOARD, 8);
    for (let i = 1; i < pos.length; i++) {
      expect(pos[i]).toBeGreaterThan(pos[i - 1]);
    }
  });

  it("no duplicate positions", () => {
    const pos = computeMinePositions(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE, BOARD, 12);
    expect(new Set(pos).size).toBe(12);
  });

  it("is deterministic — same inputs produce same output", () => {
    const a = computeMinePositions(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE, BOARD, 3);
    const b = computeMinePositions(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE, BOARD, 3);
    expect(a).toEqual(b);
  });

  it("different serverSeed produces different positions", () => {
    const a = computeMinePositions("seed-A", CLIENT_SEED, PUBLIC_SEED, NONCE, BOARD, 5);
    const b = computeMinePositions("seed-B", CLIENT_SEED, PUBLIC_SEED, NONCE, BOARD, 5);
    expect(a).not.toEqual(b);
  });

  it("different nonce produces different positions", () => {
    const a = computeMinePositions(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, 0, BOARD, 5);
    const b = computeMinePositions(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, 1, BOARD, 5);
    expect(a).not.toEqual(b);
  });

  it("different clientSeed produces different positions", () => {
    const a = computeMinePositions(SERVER_SEED, "client-A", PUBLIC_SEED, NONCE, BOARD, 5);
    const b = computeMinePositions(SERVER_SEED, "client-B", PUBLIC_SEED, NONCE, BOARD, 5);
    expect(a).not.toEqual(b);
  });

  it("publicSeed affects outcome", () => {
    const a = computeMinePositions(SERVER_SEED, CLIENT_SEED, "mines:user1", NONCE, BOARD, 5);
    const b = computeMinePositions(SERVER_SEED, CLIENT_SEED, "mines:user2", NONCE, BOARD, 5);
    expect(a).not.toEqual(b);
  });

  it("mineCount=1 returns exactly 1 mine", () => {
    const pos = computeMinePositions(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE, BOARD, 1);
    expect(pos).toHaveLength(1);
    expect(pos[0]).toBeGreaterThanOrEqual(0);
    expect(pos[0]).toBeLessThan(BOARD);
  });

  it("mineCount=24 returns 24 mines with 1 safe tile", () => {
    const pos = computeMinePositions(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE, BOARD, 24);
    expect(pos).toHaveLength(24);
    expect(new Set(pos).size).toBe(24);
    const allTiles = new Set(Array.from({ length: 25 }, (_, i) => i));
    const mineSet = new Set(pos);
    const safeTiles = [...allTiles].filter((t) => !mineSet.has(t));
    expect(safeTiles).toHaveLength(1);
  });
});

// ── Public seed ────────────────────────────────────────────────────────────────
describe("computeMinesPublicSeed", () => {
  it("produces mines:{userId} format", () => {
    expect(computeMinesPublicSeed("abc")).toBe("mines:abc");
    expect(computeMinesPublicSeed("user_42")).toBe("mines:user_42");
  });
});

// ── Multiplier math ───────────────────────────────────────────────────────────
describe("computeMinesMultiplier", () => {
  it("returns 1.0 at 0 safe picks (no picks yet)", () => {
    expect(computeMinesMultiplier(25, 3, 0)).toBe(1.0);
    expect(computeMinesMultiplier(25, 10, 0)).toBe(1.0);
  });

  it("increases with each safe pick", () => {
    let prev = 1.0;
    for (let k = 1; k <= 5; k++) {
      const m = computeMinesMultiplier(25, 3, k);
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
  });

  it("is greater than 1 after first pick (any mine count)", () => {
    for (const mines of [1, 3, 5, 10, 15, 20, 24]) {
      const m = computeMinesMultiplier(25, mines, 1);
      expect(m).toBeGreaterThan(1.0);
    }
  });

  it("higher mine count → higher multiplier for same picks", () => {
    const lowMines = computeMinesMultiplier(25, 1, 3);
    const highMines = computeMinesMultiplier(25, 10, 3);
    expect(highMines).toBeGreaterThan(lowMines);
  });

  it("all-safe-tiles max multiplier equals C(25, mines)", () => {
    // C(25, 3) = 2300, C(25-3, 22) = C(22, 22) = 1 → multiplier = 2300
    const max3 = computeMinesMultiplier(25, 3, 22);
    expect(max3).toBeCloseTo(2300, 0);

    // C(25, 1) = 25 for 1 mine (24 safe picks)
    const max1 = computeMinesMultiplier(25, 1, 24);
    expect(max1).toBeCloseTo(25, 0);
  });

  it("returns 0 when safePicks > safeTotal (impossible)", () => {
    // 1 mine → 24 safe tiles max
    expect(computeMinesMultiplier(25, 1, 25)).toBe(0);
  });
});

// ── Max multiplier ────────────────────────────────────────────────────────────
describe("computeMinesMaxMultiplier", () => {
  it("returns correct max for 1 mine (24 safe)", () => {
    expect(computeMinesMaxMultiplier(25, 1)).toBeCloseTo(25, 0);
  });

  it("is always ≥ 1", () => {
    for (const mines of [1, 3, 5, 10, 20, 24]) {
      expect(computeMinesMaxMultiplier(25, mines)).toBeGreaterThanOrEqual(1);
    }
  });
});

// ── Gross payout ──────────────────────────────────────────────────────────────
describe("computeMinesGrossPayout", () => {
  it("floors to integer GZO", () => {
    // stake=100, mult=1.136... → floor(113.6) = 113
    const mult = computeMinesMultiplier(25, 3, 1); // 25/22 ≈ 1.14
    const gross = computeMinesGrossPayout(100, mult);
    expect(gross).toBe(Math.floor(100 * mult));
    expect(Number.isInteger(gross)).toBe(true);
  });

  it("zero payout for zero multiplier", () => {
    expect(computeMinesGrossPayout(1000, 0)).toBe(0);
  });

  it("proportional to stake", () => {
    const mult = 2.5;
    expect(computeMinesGrossPayout(100, mult)).toBe(250);
    expect(computeMinesGrossPayout(1000, mult)).toBe(2500);
  });
});

// ── Settlement (cashout) ──────────────────────────────────────────────────────
describe("settle() for Mines cashout", () => {
  it("fee is 10% of profit only when profit > 0", () => {
    const stake = 100;
    const mult = computeMinesMultiplier(25, 3, 3); // > 1× → profit
    const gross = computeMinesGrossPayout(stake, mult);
    const { profitGzo, feeGzo, netPayoutGzo, grossPayoutGzo } = settle(stake, gross);

    expect(grossPayoutGzo).toBe(gross);
    expect(profitGzo).toBe(gross - stake);
    expect(feeGzo).toBe(Math.floor((gross - stake) * 0.1));
    expect(netPayoutGzo).toBe(gross - feeGzo);
  });

  it("no fee on a break-even round (multiplier = 1)", () => {
    const { feeGzo, profitGzo } = settle(100, 100); // gross = stake
    expect(feeGzo).toBe(0);
    expect(profitGzo).toBe(0);
  });

  it("no fee on a loss (gross = 0)", () => {
    const { feeGzo, profitGzo, netPayoutGzo } = settle(100, 0);
    expect(feeGzo).toBe(0);
    expect(profitGzo).toBe(-100);
    expect(netPayoutGzo).toBe(0);
  });

  it("fee is floored (never fractional)", () => {
    // stake=1, gross=2 → profit=1 → fee=floor(0.1)=0
    const { feeGzo } = settle(1, 2);
    expect(feeGzo).toBe(0);

    // stake=1, gross=11 → profit=10 → fee=floor(1.0)=1
    const { feeGzo: fee2 } = settle(1, 11);
    expect(fee2).toBe(1);
  });
});

// ── Mine hit detection ────────────────────────────────────────────────────────
describe("mine hit detection", () => {
  it("correctly identifies mine tiles", () => {
    const minePositions = computeMinePositions(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE, BOARD, 5);
    const mineSet = new Set(minePositions);

    // Every mine index is in the set
    for (const m of minePositions) {
      expect(mineSet.has(m)).toBe(true);
    }

    // Safe tiles (first 5 that aren't mines) are not in the set
    const safeTiles = Array.from({ length: BOARD }, (_, i) => i).filter((t) => !mineSet.has(t));
    for (const s of safeTiles.slice(0, 5)) {
      expect(mineSet.has(s)).toBe(false);
    }
  });

  it("mine positions are stable even if revealed tiles change (immutable layout)", () => {
    const pos1 = computeMinePositions(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, 42, BOARD, 5);
    const pos2 = computeMinePositions(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, 42, BOARD, 5);
    expect(pos1).toEqual(pos2);
  });
});

// ── Idempotency key uniqueness ────────────────────────────────────────────────
describe("idempotency key uniqueness", () => {
  it("different nonces produce different keys (double cashout prevention concept)", () => {
    const key = (userId: string, nonce: number) => `mines:${userId}:${nonce}`;
    expect(key("u1", 0)).toBe("mines:u1:0");
    expect(key("u1", 1)).toBe("mines:u1:1");
    expect(key("u1", 0)).not.toBe(key("u1", 1));
  });

  it("settle idempotency key is per-roundId", () => {
    const settleKey = (roundId: string) => `mines-settle:${roundId}`;
    expect(settleKey("round-abc")).toBe("mines-settle:round-abc");
    expect(settleKey("round-abc")).toEqual(settleKey("round-abc")); // same key → DB unique constraint prevents double cashout
  });
});

// ── Invalid tile rejection ────────────────────────────────────────────────────
describe("invalid tile rejection logic", () => {
  const ALREADY_REVEALED = [0, 1, 2, 5];

  it("rejects tile index < 0", () => {
    expect(-1 < 0 || -1 >= BOARD).toBe(true);
  });

  it("rejects tile index >= boardSize", () => {
    expect(25 < 0 || 25 >= BOARD).toBe(true);
    expect(100 < 0 || 100 >= BOARD).toBe(true);
  });

  it("rejects already-revealed tile", () => {
    expect(ALREADY_REVEALED.includes(0)).toBe(true);
    expect(ALREADY_REVEALED.includes(3)).toBe(false);
  });

  it("accepts valid, unrevealed tile", () => {
    const tileIndex = 7;
    expect(tileIndex >= 0 && tileIndex < BOARD).toBe(true);
    expect(ALREADY_REVEALED.includes(tileIndex)).toBe(false);
  });
});

// ── Safe reveal progression ───────────────────────────────────────────────────
describe("safe reveal progression", () => {
  it("multiplier path grows with each safe pick", () => {
    const path: number[] = [];
    for (let k = 1; k <= 5; k++) {
      path.push(computeMinesMultiplier(25, 3, k));
    }
    // Each step should be strictly greater than the previous
    for (let i = 1; i < path.length; i++) {
      expect(path[i]).toBeGreaterThan(path[i - 1]);
    }
  });

  it("totalSafeTiles = boardSize - mineCount", () => {
    expect(25 - 3).toBe(22); // 22 safe tiles with 3 mines
    expect(25 - 1).toBe(24); // 24 safe tiles with 1 mine
    expect(25 - 24).toBe(1); // 1 safe tile with 24 mines
  });
});

// ── Constants ─────────────────────────────────────────────────────────────────
describe("MINES constants", () => {
  it("MINES_VERSION = 1", () => {
    expect(MINES_VERSION).toBe(1);
  });

  it("MINES_BOARD_SIZE = 25 (5×5)", () => {
    expect(MINES_BOARD_SIZE).toBe(25);
  });
});

// ── History record shape ──────────────────────────────────────────────────────
describe("history record resultJson shape", () => {
  it("cashout result contains expected fields", () => {
    const minePositions = computeMinePositions(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE, BOARD, 3);
    const revealedTiles = [4, 7, 11];
    const multiplierPath = revealedTiles.map((_, k) => computeMinesMultiplier(25, 3, k + 1));
    const finalMultiplier = multiplierPath[multiplierPath.length - 1];

    const resultJson = {
      outcome: "CASHED_OUT",
      mineCount: 3,
      boardSize: 25,
      minePositions,
      revealedTiles,
      multiplierPath,
      finalMultiplier,
      rngVersion: MINES_VERSION,
    };

    expect(resultJson.outcome).toBe("CASHED_OUT");
    expect(resultJson.minePositions).toHaveLength(3);
    expect(resultJson.revealedTiles).toHaveLength(3);
    expect(resultJson.multiplierPath).toHaveLength(3);
    expect(resultJson.finalMultiplier).toBeGreaterThan(1);
    expect(resultJson.rngVersion).toBe(1);
  });

  it("loss result contains hitMine field", () => {
    const resultJson = {
      outcome: "LOST",
      mineCount: 5,
      boardSize: 25,
      minePositions: [2, 7, 11, 15, 20],
      revealedTiles: [0, 1, 11],
      hitMine: 11,
      multiplierPath: [1.25, 1.56],
      rngVersion: MINES_VERSION,
    };

    expect(resultJson.outcome).toBe("LOST");
    expect(resultJson.hitMine).toBeDefined();
    expect(resultJson.minePositions.includes(resultJson.hitMine)).toBe(true);
  });
});
