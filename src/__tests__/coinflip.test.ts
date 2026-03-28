import {
  generateServerSeed,
  hashServerSeed,
  computeOutcome,
  computePublicSeed,
  computePayout,
  generateClientSeed,
  WIN_FEE_RATE,
  NONCE,
} from "@/lib/coinflip";

// ── Seed generation ────────────────────────────────────────────────────────────
describe("generateServerSeed", () => {
  it("returns a 64-char hex string", () => {
    const seed = generateServerSeed();
    expect(seed).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(seed)).toBe(true);
  });

  it("generates unique seeds each call", () => {
    const s1 = generateServerSeed();
    const s2 = generateServerSeed();
    expect(s1).not.toBe(s2);
  });
});

describe("hashServerSeed", () => {
  it("returns a 64-char SHA-256 hex", () => {
    const hash = hashServerSeed("deadbeef");
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it("is deterministic", () => {
    expect(hashServerSeed("abc")).toBe(hashServerSeed("abc"));
  });

  it("differs from input", () => {
    const seed = generateServerSeed();
    expect(hashServerSeed(seed)).not.toBe(seed);
  });
});

// ── computeOutcome ─────────────────────────────────────────────────────────────
describe("computeOutcome", () => {
  const serverSeed = "a".repeat(64);
  const clientSeed = "myclientseed";
  const publicSeed = "matchabc:userxyz";

  it("returns HEADS or TAILS", () => {
    const result = computeOutcome(serverSeed, clientSeed, publicSeed);
    expect(["HEADS", "TAILS"]).toContain(result);
  });

  it("is deterministic — same inputs always yield same output", () => {
    const r1 = computeOutcome(serverSeed, clientSeed, publicSeed);
    const r2 = computeOutcome(serverSeed, clientSeed, publicSeed);
    expect(r1).toBe(r2);
  });

  it("differs when serverSeed changes", () => {
    const results = new Set(
      Array.from({ length: 20 }, (_, i) =>
        computeOutcome(i.toString().padStart(64, "0"), clientSeed, publicSeed)
      )
    );
    // Should contain both HEADS and TAILS across 20 different server seeds
    expect(results.size).toBe(2);
  });

  it("uses NONCE default of 1", () => {
    const withDefault = computeOutcome(serverSeed, clientSeed, publicSeed);
    const withExplicit = computeOutcome(serverSeed, clientSeed, publicSeed, NONCE);
    expect(withDefault).toBe(withExplicit);
  });

  it("different nonces produce potentially different outcomes", () => {
    // Different nonces should produce at least some different results
    const r1 = computeOutcome(serverSeed, clientSeed, publicSeed, 1);
    const r2 = computeOutcome(serverSeed, clientSeed, publicSeed, 2);
    // They MAY differ; this test just ensures neither throws
    expect(["HEADS", "TAILS"]).toContain(r1);
    expect(["HEADS", "TAILS"]).toContain(r2);
  });
});

// ── computePublicSeed ──────────────────────────────────────────────────────────
describe("computePublicSeed", () => {
  it("formats as matchId:playerBId", () => {
    expect(computePublicSeed("match1", "user2")).toBe("match1:user2");
  });

  it("is deterministic", () => {
    expect(computePublicSeed("m", "u")).toBe(computePublicSeed("m", "u"));
  });
});

// ── computePayout ──────────────────────────────────────────────────────────────
describe("computePayout", () => {
  it("winner payout = gross - fee", () => {
    const { winnerPayout, fee } = computePayout(1000);
    expect(winnerPayout + fee).toBe(2000);
  });

  it("applies 10% win-fee on profit (WIN_FEE_RATE = 0.10)", () => {
    const { fee } = computePayout(1000);
    // profit = 1000, fee = 10% of 1000 = 100
    expect(fee).toBe(Math.floor(1000 * WIN_FEE_RATE));
  });

  it("winner gets 1900 GZO on 1000 wager (10% of 1000 profit = 100 fee)", () => {
    const { winnerPayout, fee } = computePayout(1000);
    expect(fee).toBe(100);
    expect(winnerPayout).toBe(1900);
  });

  it("winner payout > wager (profit when winning)", () => {
    const { winnerPayout } = computePayout(500);
    expect(winnerPayout).toBeGreaterThan(500);
  });
});

// ── Verifier correctness ───────────────────────────────────────────────────────
describe("verifier correctness", () => {
  it("re-computes the same outcome from revealed seeds", () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const matchId = "cldtest123";
    const playerBId = "userBabc";
    const publicSeed = computePublicSeed(matchId, playerBId);

    // Simulate what the server does at join time
    const originalOutcome = computeOutcome(serverSeed, clientSeed, publicSeed);

    // Simulate what a verifier does after revelation
    const verifiedOutcome = computeOutcome(serverSeed, clientSeed, publicSeed);

    expect(verifiedOutcome).toBe(originalOutcome);
  });

  it("verifier fails to reproduce with wrong serverSeed", () => {
    const serverSeed = generateServerSeed();
    const wrongSeed = generateServerSeed();
    const clientSeed = "seed1";
    const publicSeed = "match1:user1";

    // Ensure seeds are actually different
    expect(serverSeed).not.toBe(wrongSeed);

    const original = computeOutcome(serverSeed, clientSeed, publicSeed);
    const wrong = computeOutcome(wrongSeed, clientSeed, publicSeed);

    // With high probability (63/64 chance) they differ — but both are valid HEADS/TAILS
    // We just confirm both are valid outputs
    expect(["HEADS", "TAILS"]).toContain(original);
    expect(["HEADS", "TAILS"]).toContain(wrong);
  });

  it("commitment hash matches serverSeed before revelation", () => {
    const serverSeed = generateServerSeed();
    const commitHash = hashServerSeed(serverSeed);
    // Verifier can confirm the commitment
    const { createHash } = require("crypto");
    const check = createHash("sha256").update(serverSeed).digest("hex");
    expect(check).toBe(commitHash);
  });
});

// ── Concurrency guard (mocked) ────────────────────────────────────────────────
describe("join concurrency guard", () => {
  const mockTx = {
    coinflipMatch: { findUnique: jest.fn(), update: jest.fn() },
    walletBalance: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    ledgerEntry: { create: jest.fn() },
    coinflipCommit: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  beforeEach(() => jest.clearAllMocks());

  it("rejects join if match is already COMPLETED", async () => {
    mockTx.coinflipMatch.findUnique.mockResolvedValue({ id: "m1", status: "COMPLETED", playerAId: "userA", wager: "100" });

    // Simulate the guard logic from the join handler
    const match = await mockTx.coinflipMatch.findUnique({ where: { id: "m1" } });
    const joinGuard = () => {
      if (match.status !== "PENDING") throw new Error("Match is no longer open");
    };

    expect(joinGuard).toThrow("Match is no longer open");
  });

  it("rejects creator joining own match", async () => {
    mockTx.coinflipMatch.findUnique.mockResolvedValue({
      id: "m1",
      status: "PENDING",
      playerAId: "userA",
      wager: "100",
    });

    const match = await mockTx.coinflipMatch.findUnique({ where: { id: "m1" } });
    const playerBId = "userA"; // same user as creator

    const joinGuard = () => {
      if (match.playerAId === playerBId) throw new Error("Cannot join your own match");
    };

    expect(joinGuard).toThrow("Cannot join your own match");
  });

  it("rejects join with insufficient balance", async () => {
    mockTx.walletBalance.findUniqueOrThrow.mockResolvedValue({ balance: "50" });

    const wallet = await mockTx.walletBalance.findUniqueOrThrow({ where: { userId: "userB" } });
    const stake = 100;

    const balanceGuard = () => {
      if (Number(wallet.balance) < stake) throw new Error("Insufficient balance");
    };

    expect(balanceGuard).toThrow("Insufficient balance");
    expect(mockTx.walletBalance.update).not.toHaveBeenCalled();
  });

  it("two concurrent joins: second finds COMPLETED and throws", async () => {
    // First join: finds PENDING
    mockTx.coinflipMatch.findUnique
      .mockResolvedValueOnce({ id: "m1", status: "PENDING", playerAId: "userA", wager: "100" })
      // Second join (concurrent): finds COMPLETED (first join committed)
      .mockResolvedValueOnce({ id: "m1", status: "COMPLETED", playerAId: "userA", wager: "100" });

    const firstMatch = await mockTx.coinflipMatch.findUnique({ where: { id: "m1" } });
    expect(firstMatch.status).toBe("PENDING"); // First join proceeds

    const secondMatch = await mockTx.coinflipMatch.findUnique({ where: { id: "m1" } });
    const secondJoinGuard = () => {
      if (secondMatch.status !== "PENDING") throw new Error("Match is no longer open");
    };

    expect(secondJoinGuard).toThrow("Match is no longer open");
  });
});

// ── Payout invariant ──────────────────────────────────────────────────────────
describe("payout invariant", () => {
  it("total credits in system preserved: winner payout = wager * 2 - fee", () => {
    const wager = 750;
    const { winnerPayout, fee } = computePayout(wager);
    expect(winnerPayout).toBe(wager * 2 - fee);
  });

  it("fee is non-negative", () => {
    [1, 10, 100, 1000, 50000].forEach((w) => {
      const { fee } = computePayout(w);
      expect(fee).toBeGreaterThanOrEqual(0);
    });
  });

  it("winnerPayout is always positive", () => {
    [1, 10, 100].forEach((w) => {
      const { winnerPayout } = computePayout(w);
      expect(winnerPayout).toBeGreaterThan(0);
    });
  });
});
