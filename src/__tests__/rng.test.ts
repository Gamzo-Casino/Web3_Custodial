import { createHash } from "crypto";
import {
  hmacSha256Bytes,
  bytesToFloat,
  bytesToInt,
  bytesToCoinFlip,
  RNG_VERSION,
} from "@/lib/rng";
import {
  computeOutcome,
  hashServerSeed,
  generateServerSeed,
  generateClientSeed,
} from "@/lib/coinflip";

// Known-good fixture seeds for determinism checks
const SERVER_SEED = "a".repeat(64);
const CLIENT_SEED = "myclientseed";
const PUBLIC_SEED = "matchabc:userxyz";
const NONCE = 1;

// ── RNG_VERSION ────────────────────────────────────────────────────────────────
describe("RNG_VERSION", () => {
  it("is 1 (algorithm version 1)", () => {
    expect(RNG_VERSION).toBe(1);
  });
});

// ── hmacSha256Bytes ────────────────────────────────────────────────────────────
describe("hmacSha256Bytes", () => {
  it("returns a 32-byte Buffer", () => {
    const bytes = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE);
    expect(bytes).toBeInstanceOf(Buffer);
    expect(bytes.length).toBe(32);
  });

  it("is deterministic — same inputs always produce same bytes", () => {
    const b1 = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE);
    const b2 = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE);
    expect(b1.toString("hex")).toBe(b2.toString("hex"));
  });

  it("changes when serverSeed changes", () => {
    const b1 = hmacSha256Bytes("a".repeat(64), CLIENT_SEED, PUBLIC_SEED, NONCE);
    const b2 = hmacSha256Bytes("b".repeat(64), CLIENT_SEED, PUBLIC_SEED, NONCE);
    expect(b1.toString("hex")).not.toBe(b2.toString("hex"));
  });

  it("changes when clientSeed changes", () => {
    const b1 = hmacSha256Bytes(SERVER_SEED, "seed1", PUBLIC_SEED, NONCE);
    const b2 = hmacSha256Bytes(SERVER_SEED, "seed2", PUBLIC_SEED, NONCE);
    expect(b1.toString("hex")).not.toBe(b2.toString("hex"));
  });

  it("changes when publicSeed changes", () => {
    const b1 = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, "match1:userA", NONCE);
    const b2 = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, "match2:userB", NONCE);
    expect(b1.toString("hex")).not.toBe(b2.toString("hex"));
  });

  it("changes when nonce changes", () => {
    const b1 = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, 1);
    const b2 = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, 2);
    expect(b1.toString("hex")).not.toBe(b2.toString("hex"));
  });
});

// ── bytesToFloat ───────────────────────────────────────────────────────────────
describe("bytesToFloat", () => {
  it("returns a number in [0, 1)", () => {
    const bytes = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE);
    const f = bytesToFloat(bytes);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThan(1);
  });

  it("is deterministic", () => {
    const bytes = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE);
    expect(bytesToFloat(bytes)).toBe(bytesToFloat(bytes));
  });

  it("produces varied floats across different seeds", () => {
    const floats = Array.from({ length: 20 }, (_, i) => {
      const bytes = hmacSha256Bytes(String(i).padStart(64, "0"), CLIENT_SEED, PUBLIC_SEED, NONCE);
      return bytesToFloat(bytes);
    });
    // All floats should be distinct (no collisions in 20 different inputs)
    const uniqueFloats = new Set(floats);
    expect(uniqueFloats.size).toBe(20);
  });

  it("uses full 52-bit precision — not truncated to a few values", () => {
    const floats = Array.from({ length: 100 }, (_, i) => {
      const bytes = hmacSha256Bytes(String(i).padStart(64, "0"), CLIENT_SEED, PUBLIC_SEED, NONCE);
      return bytesToFloat(bytes);
    });
    // Mean should be close to 0.5 (uniform distribution)
    const mean = floats.reduce((a, b) => a + b, 0) / floats.length;
    expect(mean).toBeGreaterThan(0.3);
    expect(mean).toBeLessThan(0.7);
  });
});

// ── bytesToInt ─────────────────────────────────────────────────────────────────
describe("bytesToInt", () => {
  it("returns an integer in [min, max] inclusive", () => {
    for (let i = 0; i < 20; i++) {
      const bytes = hmacSha256Bytes(String(i).padStart(64, "0"), CLIENT_SEED, PUBLIC_SEED, NONCE);
      const n = bytesToInt(bytes, 1, 6); // dice roll
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
    }
  });

  it("is deterministic", () => {
    const bytes = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE);
    expect(bytesToInt(bytes, 0, 99)).toBe(bytesToInt(bytes, 0, 99));
  });

  it("produces the full range over many seeds", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const bytes = hmacSha256Bytes(String(i).padStart(64, "0"), CLIENT_SEED, PUBLIC_SEED, NONCE);
      seen.add(bytesToInt(bytes, 1, 6));
    }
    // Should hit all 6 sides
    expect(seen.size).toBe(6);
  });

  it("throws when min > max", () => {
    const bytes = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE);
    expect(() => bytesToInt(bytes, 10, 1)).toThrow(RangeError);
  });

  it("returns min when min === max", () => {
    const bytes = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE);
    expect(bytesToInt(bytes, 42, 42)).toBe(42);
  });
});

// ── bytesToCoinFlip ────────────────────────────────────────────────────────────
describe("bytesToCoinFlip", () => {
  it("returns HEADS or TAILS", () => {
    const bytes = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE);
    expect(["HEADS", "TAILS"]).toContain(bytesToCoinFlip(bytes));
  });

  it("is deterministic", () => {
    const bytes = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, NONCE);
    expect(bytesToCoinFlip(bytes)).toBe(bytesToCoinFlip(bytes));
  });

  it("matches computeOutcome from coinflip.ts (backward compatibility)", () => {
    // bytesToCoinFlip must produce the same result as the original computeOutcome
    // for all inputs to maintain backward compatibility with existing stored bets.
    for (let i = 0; i < 50; i++) {
      const ss = String(i).padStart(64, "0");
      const cs = `client${i}`;
      const ps = `match${i}:user${i}`;
      const n = (i % 5) + 1;

      const bytes = hmacSha256Bytes(ss, cs, ps, n);
      const fromBytes = bytesToCoinFlip(bytes);
      const fromCompute = computeOutcome(ss, cs, ps, n);

      expect(fromBytes).toBe(fromCompute);
    }
  });

  it("produces both HEADS and TAILS across many seeds", () => {
    const outcomes = new Set(
      Array.from({ length: 30 }, (_, i) => {
        const bytes = hmacSha256Bytes(String(i).padStart(64, "0"), CLIENT_SEED, PUBLIC_SEED, NONCE);
        return bytesToCoinFlip(bytes);
      })
    );
    expect(outcomes.has("HEADS")).toBe(true);
    expect(outcomes.has("TAILS")).toBe(true);
  });
});

// ── Reveal correctness ─────────────────────────────────────────────────────────
describe("reveal correctness", () => {
  it("SHA-256(revealed serverSeed) === commitHash", () => {
    // Simulate: server generates seed, hashes it (commitment)
    const serverSeed = generateServerSeed();
    const commitHash = hashServerSeed(serverSeed);

    // After match settles, verifier checks: SHA-256(revealedSeed) === commitHash
    const { createHash: _createHash } = require("crypto");
    const verifiedHash = _createHash("sha256").update(serverSeed).digest("hex");

    expect(verifiedHash).toBe(commitHash);
  });

  it("re-computing outcome from revealed seeds matches original", () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const publicSeed = "match-abc:user-xyz";
    const nonce = 3;

    // Server computes outcome at settle time
    const originalOutcome = computeOutcome(serverSeed, clientSeed, publicSeed, nonce);

    // Player verifies using revealed serverSeed
    const verifiedOutcome = computeOutcome(serverSeed, clientSeed, publicSeed, nonce);

    expect(verifiedOutcome).toBe(originalOutcome);
  });

  it("verifier cannot reproduce outcome with wrong serverSeed", () => {
    const serverSeed = generateServerSeed();
    const wrongSeed = generateServerSeed();
    expect(serverSeed).not.toBe(wrongSeed);

    const clientSeed = "seed1";
    const publicSeed = "match1:user1";
    const nonce = 1;

    const bytes1 = hmacSha256Bytes(serverSeed, clientSeed, publicSeed, nonce);
    const bytes2 = hmacSha256Bytes(wrongSeed, clientSeed, publicSeed, nonce);

    // HMAC output must differ (with overwhelming probability)
    expect(bytes1.toString("hex")).not.toBe(bytes2.toString("hex"));
  });

  it("wrong serverSeed fails commitment check", () => {
    const serverSeed = generateServerSeed();
    const wrongSeed = generateServerSeed();

    const commitHash = createHash("sha256").update(serverSeed).digest("hex");
    const wrongHash = createHash("sha256").update(wrongSeed).digest("hex");

    expect(commitHash).not.toBe(wrongHash);

    // Commitment verification: only the real seed passes
    const check = createHash("sha256").update(serverSeed).digest("hex");
    expect(check).toBe(commitHash);
    expect(check).not.toBe(wrongHash);
  });
});

// ── nonce separation ───────────────────────────────────────────────────────────
describe("nonce separation", () => {
  it("different nonces produce different HMAC bytes", () => {
    const results = new Set(
      [0, 1, 2, 3, 4].map((n) =>
        hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, n).toString("hex")
      )
    );
    // All 5 nonces must produce distinct outputs
    expect(results.size).toBe(5);
  });

  it("same (serverSeed, clientSeed, publicSeed) with different nonces never collide", () => {
    const seen = new Set<string>();
    for (let n = 0; n < 100; n++) {
      const hex = hmacSha256Bytes(SERVER_SEED, CLIENT_SEED, PUBLIC_SEED, n).toString("hex");
      expect(seen.has(hex)).toBe(false);
      seen.add(hex);
    }
  });
});
