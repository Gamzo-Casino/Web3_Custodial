// ── Mock Prisma ────────────────────────────────────────────────────────────────
const mockTx = {
  walletBalance: {
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  ledgerEntry: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn((fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
    walletBalance: { findUnique: jest.fn() },
    ledgerEntry: { findMany: jest.fn() },
  },
}));

import { creditWallet, debitWallet, initializeWallet, AIRDROP_AMOUNT, LedgerEntryType } from "@/lib/ledger";

beforeEach(() => jest.clearAllMocks());

// ── creditWallet ───────────────────────────────────────────────────────────────
describe("creditWallet", () => {
  it("adds amount to wallet and creates ledger entry", async () => {
    mockTx.walletBalance.findUniqueOrThrow.mockResolvedValue({ balance: "500" });
    mockTx.walletBalance.update.mockResolvedValue({ balance: "600" });
    mockTx.ledgerEntry.create.mockResolvedValue({});

    const newBalance = await creditWallet("user-1", 100, LedgerEntryType.DEPOSIT);

    expect(newBalance).toBe(600);
    expect(mockTx.walletBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ balance: "600" }) })
    );
    expect(mockTx.ledgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: "100",
          balanceBefore: "500",
          balanceAfter: "600",
          type: LedgerEntryType.DEPOSIT,
        }),
      })
    );
  });

  it("throws when amount is zero", async () => {
    await expect(creditWallet("user-1", 0, LedgerEntryType.DEPOSIT)).rejects.toThrow(
      "Credit amount must be positive"
    );
  });

  it("throws when amount is negative", async () => {
    await expect(creditWallet("user-1", -50, LedgerEntryType.DEPOSIT)).rejects.toThrow(
      "Credit amount must be positive"
    );
  });
});

// ── debitWallet ────────────────────────────────────────────────────────────────
describe("debitWallet", () => {
  it("subtracts amount and creates ledger entry", async () => {
    mockTx.walletBalance.findUniqueOrThrow.mockResolvedValue({ balance: "1000" });
    mockTx.walletBalance.update.mockResolvedValue({ balance: "750" });
    mockTx.ledgerEntry.create.mockResolvedValue({});

    const newBalance = await debitWallet("user-1", 250, LedgerEntryType.BET_PLACED);

    expect(newBalance).toBe(750);
    expect(mockTx.ledgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: "250",
          balanceBefore: "1000",
          balanceAfter: "750",
          type: LedgerEntryType.BET_PLACED,
        }),
      })
    );
  });

  it("throws on insufficient balance — prevents negative balance", async () => {
    mockTx.walletBalance.findUniqueOrThrow.mockResolvedValue({ balance: "100" });

    await expect(debitWallet("user-1", 200, LedgerEntryType.BET_PLACED)).rejects.toThrow(
      "Insufficient balance"
    );

    // Wallet should NOT have been updated
    expect(mockTx.walletBalance.update).not.toHaveBeenCalled();
  });

  it("throws when amount is zero", async () => {
    await expect(debitWallet("user-1", 0, LedgerEntryType.BET_PLACED)).rejects.toThrow(
      "Debit amount must be positive"
    );
  });

  it("prevents exact-balance debit edge case (allows spending entire balance)", async () => {
    mockTx.walletBalance.findUniqueOrThrow.mockResolvedValue({ balance: "500" });
    mockTx.walletBalance.update.mockResolvedValue({ balance: "0" });
    mockTx.ledgerEntry.create.mockResolvedValue({});

    const balance = await debitWallet("user-1", 500, LedgerEntryType.BET_PLACED);
    expect(balance).toBe(0);
  });
});

// ── initializeWallet ───────────────────────────────────────────────────────────
describe("initializeWallet", () => {
  it("creates wallet with airdrop amount and ledger entry", async () => {
    mockTx.walletBalance.create.mockResolvedValue({});
    mockTx.ledgerEntry.create.mockResolvedValue({});

    await initializeWallet(mockTx, "user-new", AIRDROP_AMOUNT);

    expect(mockTx.walletBalance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user-new", balance: String(AIRDROP_AMOUNT) }),
      })
    );
    expect(mockTx.ledgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: LedgerEntryType.DEPOSIT,
          amount: String(AIRDROP_AMOUNT),
          balanceBefore: "0",
          balanceAfter: String(AIRDROP_AMOUNT),
          reference: "signup-airdrop",
        }),
      })
    );
  });

  it("AIRDROP_AMOUNT is 1000", () => {
    expect(AIRDROP_AMOUNT).toBe(1000);
  });
});

// ── Ledger immutability invariant ──────────────────────────────────────────────
describe("ledger invariants", () => {
  it("balanceAfter equals balanceBefore + amount on credit", async () => {
    mockTx.walletBalance.findUniqueOrThrow.mockResolvedValue({ balance: "300" });
    mockTx.walletBalance.update.mockResolvedValue({});
    mockTx.ledgerEntry.create.mockResolvedValue({});

    await creditWallet("user-1", 200, LedgerEntryType.BET_WON);

    const call = mockTx.ledgerEntry.create.mock.calls[0][0].data;
    const before = Number(call.balanceBefore);
    const amount = Number(call.amount);
    const after = Number(call.balanceAfter);
    expect(after).toBe(before + amount);
  });

  it("balanceAfter equals balanceBefore - amount on debit", async () => {
    mockTx.walletBalance.findUniqueOrThrow.mockResolvedValue({ balance: "800" });
    mockTx.walletBalance.update.mockResolvedValue({});
    mockTx.ledgerEntry.create.mockResolvedValue({});

    await debitWallet("user-1", 300, LedgerEntryType.BET_PLACED);

    const call = mockTx.ledgerEntry.create.mock.calls[0][0].data;
    expect(Number(call.balanceAfter)).toBe(Number(call.balanceBefore) - Number(call.amount));
  });
});
