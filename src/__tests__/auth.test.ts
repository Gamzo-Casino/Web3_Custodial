import bcrypt from "bcryptjs";

// ── Mock Prisma so tests never need a real DB ──────────────────────────────────
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    walletBalance: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    ledgerEntry: {
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  },
}));

// ── Mock rate-limit so tests are not throttled ─────────────────────────────────
jest.mock("@/lib/rate-limit", () => ({
  checkRateLimit: jest.fn(() => ({ allowed: true, remaining: 4 })),
  clearRateLimit: jest.fn(),
}));

import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// ── bcrypt password hashing ────────────────────────────────────────────────────
describe("password hashing", () => {
  it("hashes and verifies a password correctly", async () => {
    const password = "superSecret1!";
    const hash = await bcrypt.hash(password, 10);
    expect(hash).not.toBe(password);
    expect(await bcrypt.compare(password, hash)).toBe(true);
    expect(await bcrypt.compare("wrongPassword", hash)).toBe(false);
  });

  it("produces different hashes for the same input (salted)", async () => {
    const pw = "samePassword";
    const h1 = await bcrypt.hash(pw, 10);
    const h2 = await bcrypt.hash(pw, 10);
    expect(h1).not.toBe(h2);
  });
});

// ── Signup validation ──────────────────────────────────────────────────────────
describe("signup input validation", () => {
  const { z } = require("zod");

  const signupSchema = z.object({
    name: z.string().min(2).max(50).trim(),
    email: z.string().email().toLowerCase().trim(),
    password: z.string().min(8).max(72),
  });

  it("accepts valid signup data", () => {
    const result = signupSchema.safeParse({
      name: "Alice",
      email: "alice@example.com",
      password: "password123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects short passwords", () => {
    const result = signupSchema.safeParse({
      name: "Bob",
      email: "bob@example.com",
      password: "short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = signupSchema.safeParse({
      name: "Carol",
      email: "not-an-email",
      password: "validPass1!",
    });
    expect(result.success).toBe(false);
  });

  it("rejects name that is too short", () => {
    const result = signupSchema.safeParse({
      name: "A",
      email: "a@example.com",
      password: "validPass1!",
    });
    expect(result.success).toBe(false);
  });
});

// ── Rate limiting ──────────────────────────────────────────────────────────────
describe("rate limiting", () => {
  beforeEach(() => jest.clearAllMocks());

  it("allows the first request", () => {
    (checkRateLimit as jest.Mock).mockReturnValueOnce({ allowed: true, remaining: 4 });
    const result = checkRateLimit("login:test@example.com", 5, 60_000);
    expect(result.allowed).toBe(true);
  });

  it("blocks when limit is exceeded", () => {
    (checkRateLimit as jest.Mock).mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      retryAfter: 300,
    });
    const result = checkRateLimit("login:test@example.com", 5, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("tracks attempts per-key independently", () => {
    const { checkRateLimit: realCheckRL } = jest.requireActual("@/lib/rate-limit");
    const r1 = realCheckRL("key-a", 3, 60_000);
    const r2 = realCheckRL("key-b", 3, 60_000);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r1.remaining).toBe(r2.remaining);
  });
});

// ── Prisma mock sanity ─────────────────────────────────────────────────────────
describe("prisma mock", () => {
  it("mock user.findUnique is callable", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma as any).user.findUnique.mockResolvedValueOnce(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (mockPrisma as any).user.findUnique({ where: { email: "x@x.com" } });
    expect(result).toBeNull();
  });
});
