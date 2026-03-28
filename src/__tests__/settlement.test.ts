import { settle, WIN_FEE_RATE } from "@/lib/settlement";

describe("WIN_FEE_RATE", () => {
  it("is exactly 0.10 (10%)", () => {
    expect(WIN_FEE_RATE).toBe(0.1);
  });
});

// ── settle() core rules ────────────────────────────────────────────────────────
describe("settle()", () => {
  // Winner scenario: gross > stake
  describe("on a win (gross > stake)", () => {
    it("profit = gross - stake", () => {
      const { profitGzo } = settle(1000, 2000);
      expect(profitGzo).toBe(1000);
    });

    it("fee = 10% of profit (floor)", () => {
      const { feeGzo } = settle(1000, 2000);
      expect(feeGzo).toBe(100); // 10% of 1000
    });

    it("netPayout = gross - fee", () => {
      const { netPayoutGzo, grossPayoutGzo, feeGzo } = settle(1000, 2000);
      expect(netPayoutGzo).toBe(grossPayoutGzo - feeGzo);
    });

    it("player receives 1900 GZO on a 1000 stake PvP win (10% of 1000 profit = 100)", () => {
      const { netPayoutGzo, feeGzo } = settle(1000, 2000);
      expect(feeGzo).toBe(100);
      expect(netPayoutGzo).toBe(1900);
    });

    it("fee floors fractional amounts", () => {
      // profit = 1, fee = floor(0.1 * 1) = 0
      const { feeGzo } = settle(999, 1000);
      expect(feeGzo).toBe(0); // floor(1 * 0.1) = floor(0.1) = 0
    });

    it("fee floors correctly on 15 profit", () => {
      // profit = 15, fee = floor(1.5) = 1
      const { feeGzo } = settle(985, 1000);
      expect(feeGzo).toBe(1);
    });

    it("player still receives more than stake on a win", () => {
      const { netPayoutGzo } = settle(500, 1000);
      expect(netPayoutGzo).toBeGreaterThan(500);
    });
  });

  // Break-even scenario: gross == stake
  describe("on break-even (gross == stake)", () => {
    it("profit = 0, fee = 0", () => {
      const { profitGzo, feeGzo } = settle(500, 500);
      expect(profitGzo).toBe(0);
      expect(feeGzo).toBe(0);
    });

    it("netPayout = stake", () => {
      const { netPayoutGzo } = settle(500, 500);
      expect(netPayoutGzo).toBe(500);
    });
  });

  // Loss scenario: gross < stake (or zero)
  describe("on a loss (gross < stake)", () => {
    it("profit is negative, fee = 0", () => {
      const { profitGzo, feeGzo } = settle(1000, 0);
      expect(profitGzo).toBe(-1000);
      expect(feeGzo).toBe(0);
    });

    it("netPayout = 0 on total loss", () => {
      const { netPayoutGzo } = settle(1000, 0);
      expect(netPayoutGzo).toBe(0);
    });

    it("fee never goes negative", () => {
      const { feeGzo } = settle(5000, 0);
      expect(feeGzo).toBeGreaterThanOrEqual(0);
    });
  });

  // Custom fee rate
  describe("custom feeRate", () => {
    it("respects override feeRate", () => {
      const { feeGzo } = settle(1000, 2000, 0.05); // 5% of 1000 profit
      expect(feeGzo).toBe(50);
    });

    it("zero feeRate = no fee even on win", () => {
      const { feeGzo, netPayoutGzo, grossPayoutGzo } = settle(1000, 2000, 0);
      expect(feeGzo).toBe(0);
      expect(netPayoutGzo).toBe(grossPayoutGzo);
    });
  });
});

// ── PvP coinflip settlement invariants ────────────────────────────────────────
describe("PvP coinflip settlement invariants", () => {
  const stake = 1000;
  const gross = stake * 2; // winner takes pot

  it("house always profits on each PvP match: 2×stake in, netPayout out", () => {
    const { netPayoutGzo, feeGzo } = settle(stake, gross);
    // house receives: stake_A + stake_B = 2000
    // house pays: netPayoutGzo = 1900
    // house keeps: feeGzo = 100
    const houseIn = 2 * stake;
    const houseOut = netPayoutGzo;
    expect(houseIn - houseOut).toBe(feeGzo);
    expect(feeGzo).toBeGreaterThan(0);
  });

  it("treasury never goes negative from a single PvP match", () => {
    // Treasury check at creation: balance >= 0.9 × stake
    const minRequired = stake * (1 - WIN_FEE_RATE);
    const { netPayoutGzo } = settle(stake, gross);
    // Worst case net outflow to house from match = netPayoutGzo - 2×stake (always negative = profit)
    const netFlow = netPayoutGzo - 2 * stake;
    expect(netFlow).toBeLessThan(0); // house always gets back more than it pays
    // If treasury starts at minRequired, after match it's at minRequired + (-netFlow) > 0
    const treasuryAfter = minRequired + 2 * stake - netPayoutGzo;
    expect(treasuryAfter).toBeGreaterThan(0);
  });

  it("winner + loser + house accounting adds up (no GZO created/destroyed)", () => {
    const { netPayoutGzo, feeGzo } = settle(stake, gross);
    // Total GZO from both players: 2 × stake
    // Winner receives: netPayoutGzo
    // Loser receives: 0
    // House retains: feeGzo
    expect(netPayoutGzo + feeGzo).toBe(gross); // = 2 × stake
  });

  it("fee is exactly 10% of profit for exact amounts", () => {
    [100, 500, 1000, 5000, 10000].forEach((s) => {
      const { profitGzo, feeGzo } = settle(s, s * 2);
      expect(feeGzo).toBe(Math.floor(profitGzo * WIN_FEE_RATE));
    });
  });
});

// ── House treasury solvency check ─────────────────────────────────────────────
describe("house solvency model", () => {
  it("minRequired = stake × (1 - WIN_FEE_RATE) = 0.9 × stake", () => {
    const stake = 1000;
    const minRequired = stake * (1 - WIN_FEE_RATE);
    expect(minRequired).toBe(900);
  });

  it("treasury starting at minRequired can cover netPayout after collecting both stakes", () => {
    const stake = 1000;
    const minRequired = stake * (1 - WIN_FEE_RATE); // 900
    const { netPayoutGzo } = settle(stake, stake * 2);

    // After receiving both stakes: treasury = minRequired + 2*stake
    const treasuryAfterEscrow = minRequired + 2 * stake; // 2900
    expect(treasuryAfterEscrow).toBeGreaterThanOrEqual(netPayoutGzo); // 2900 >= 1900 ✓
  });
});
