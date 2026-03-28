/**
 * POST /api/wallet/deposit/confirm
 *
 * After the user sends GZO on-chain to the house deposit address, the client
 * calls this endpoint with the txHash. The server:
 *   1. Verifies the tx on-chain (viem publicClient)
 *   2. Confirms the Transfer event: from=user wallet, to=house deposit address
 *   3. Creates an immutable Deposit record (txHash unique — no double-credit)
 *   4. Credits the custodial balance + writes a LedgerEntry
 *
 * Security guarantees:
 *   - txHash uniqueness in DB prevents replay attacks
 *   - fromAddress is verified against the authenticated session walletAddress
 *   - toAddress is verified against NEXT_PUBLIC_HOUSE_DEPOSIT_ADDRESS
 *   - Amount is read from the on-chain event, not from user input
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/walletSession";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { getPublicClient, ERC20_TRANSFER_ABI } from "@/lib/viemServer";
import { formatEther, parseEventLogs } from "viem";
import { z } from "zod";
import { ADDRESSES } from "@/lib/web3/contracts";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid tx hash"),
});

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { txHash } = body;

  // ── Idempotency: reject if already processed ──────────────────────────────
  const existing = await (prisma as any).deposit.findUnique({
    where: { txHash },
  });
  if (existing) {
    if (existing.status === "CONFIRMED") {
      return NextResponse.json({
        ok: true,
        alreadyProcessed: true,
        amountGzo: Number(existing.amountGzo),
      });
    }
    if (existing.status === "FAILED") {
      return NextResponse.json(
        { error: "This transaction was previously rejected" },
        { status: 409 }
      );
    }
  }

  // ── House deposit address ─────────────────────────────────────────────────
  const houseAddress = process.env.NEXT_PUBLIC_HOUSE_DEPOSIT_ADDRESS?.toLowerCase();
  if (!houseAddress || houseAddress === "0x0000000000000000000000000000000000000001") {
    console.error("[deposit/confirm] NEXT_PUBLIC_HOUSE_DEPOSIT_ADDRESS not configured");
    return NextResponse.json(
      { error: "Deposit not configured. Contact support." },
      { status: 503 }
    );
  }

  // ── Fetch tx receipt from chain ───────────────────────────────────────────
  const publicClient = getPublicClient();
  let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>;
  try {
    receipt = await publicClient.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
  } catch (err) {
    console.error("[deposit/confirm] receipt fetch error:", err);
    return NextResponse.json(
      { error: "Transaction not found or not yet confirmed. Try again in a moment." },
      { status: 404 }
    );
  }

  // Tx must be successful
  if (receipt.status !== "success") {
    await (prisma as any).deposit.upsert({
      where: { txHash },
      create: {
        txHash,
        userId: session.userId,
        fromAddress: session.walletAddress,
        amountGzo: "0",
        status: "FAILED",
      },
      update: { status: "FAILED" },
    });
    return NextResponse.json({ error: "Transaction failed on-chain" }, { status: 422 });
  }

  // ── Parse Transfer events from the GZO token contract ────────────────────
  const transferLogs = parseEventLogs({
    abi: ERC20_TRANSFER_ABI,
    logs: receipt.logs,
    eventName: "Transfer",
  });

  // Find the Transfer event: from=user, to=house
  const userAddress = session.walletAddress.toLowerCase();
  const matchingTransfer = transferLogs.find(
    (log) =>
      (log.args as any).from?.toLowerCase() === userAddress &&
      (log.args as any).to?.toLowerCase() === houseAddress
  );

  if (!matchingTransfer) {
    // Check if the tx came from a different address (wrong wallet)
    const anyToHouse = transferLogs.find(
      (log) => (log.args as any).to?.toLowerCase() === houseAddress
    );
    if (anyToHouse) {
      return NextResponse.json(
        { error: "Sender address does not match your authenticated wallet" },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: "No GZO transfer to the house deposit address found in this transaction" },
      { status: 422 }
    );
  }

  // ── Verify the tx target was the GZO token contract ──────────────────────
  const gzoAddress = ADDRESSES.gzoToken?.toLowerCase();
  if (receipt.to?.toLowerCase() !== gzoAddress) {
    return NextResponse.json(
      { error: "Transaction was not sent to the GZO token contract" },
      { status: 422 }
    );
  }

  // ── Extract amount (wei → GZO) ────────────────────────────────────────────
  const amountWei = (matchingTransfer.args as any).value as bigint;
  const amountGzo = Number(formatEther(amountWei));

  if (amountGzo < 1) {
    return NextResponse.json(
      { error: "Minimum deposit is 1 GZO" },
      { status: 422 }
    );
  }

  // ── Atomically create Deposit record + credit wallet ─────────────────────
  try {
    await (prisma as any).$transaction(async (tx: any) => {
      // Insert deposit record — unique constraint on txHash prevents double-credit
      await tx.deposit.upsert({
        where: { txHash },
        create: {
          txHash,
          userId: session.userId,
          fromAddress: userAddress,
          amountGzo: String(amountGzo),
          status: "CONFIRMED",
          confirmedAt: new Date(),
        },
        update: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
        },
      });

      // Credit the custodial wallet
      const wallet = await tx.walletBalance.findUnique({
        where: { userId: session.userId },
      });
      if (!wallet) {
        await tx.walletBalance.create({
          data: { userId: session.userId, balance: String(amountGzo) },
        });
        await tx.ledgerEntry.create({
          data: {
            userId: session.userId,
            type: LedgerEntryType.DEPOSIT,
            amount: String(amountGzo),
            balanceBefore: "0",
            balanceAfter: String(amountGzo),
            reference: `deposit:${txHash}`,
          },
        });
      } else {
        const before = Number(wallet.balance);
        const after = before + amountGzo;
        await tx.walletBalance.update({
          where: { userId: session.userId },
          data: { balance: String(after) },
        });
        await tx.ledgerEntry.create({
          data: {
            userId: session.userId,
            type: LedgerEntryType.DEPOSIT,
            amount: String(amountGzo),
            balanceBefore: String(before),
            balanceAfter: String(after),
            reference: `deposit:${txHash}`,
          },
        });
      }
    });
  } catch (err: any) {
    // Unique constraint violation = already processed (race condition)
    if (err?.code === "P2002") {
      return NextResponse.json({ ok: true, alreadyProcessed: true, amountGzo });
    }
    console.error("[deposit/confirm] DB error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, amountGzo, txHash });
}
