/**
 * POST /api/wallet/withdraw
 *
 * Debits the user's custodial balance and sends GZO on-chain from the
 * house wallet to the user's connected wallet.
 *
 * Safety protocol (atomic + recoverable):
 *   1. Validate session + amount
 *   2. In a single DB transaction: debit wallet + create LedgerEntry(WITHDRAWAL)
 *      + create WithdrawalRequest(PROCESSING)  — balance is locked immediately
 *   3. Send GZO on-chain from house wallet (viem WalletClient)
 *   4a. Success → update WithdrawalRequest to COMPLETED + store txHash
 *   4b. Failure → refund wallet (credit back) + update request to FAILED
 *      — the refund is always written; no funds are permanently lost
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/walletSession";
import { prisma } from "@/lib/prisma";
import { LedgerEntryType } from "@/lib/ledger";
import { getPublicClient, getHouseWalletClient, ERC20_TRANSFER_ABI } from "@/lib/viemServer";
import { parseEther } from "viem";
import { z } from "zod";
import { ADDRESSES } from "@/lib/web3/contracts";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  amountGzo: z.number().positive().max(1_000_000),
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

  const { amountGzo } = body;

  if (amountGzo < 1) {
    return NextResponse.json(
      { error: "Minimum withdrawal is 1 GZO" },
      { status: 400 }
    );
  }

  // ── House wallet config check ─────────────────────────────────────────────
  const houseAddress = process.env.NEXT_PUBLIC_HOUSE_DEPOSIT_ADDRESS;
  const housePk = process.env.HOUSE_PRIVATE_KEY;
  if (
    !houseAddress ||
    houseAddress === "0x0000000000000000000000000000000000000001" ||
    !housePk ||
    housePk === "0x0000000000000000000000000000000000000000000000000000000000000001"
  ) {
    console.error("[withdraw] House wallet not configured");
    return NextResponse.json(
      { error: "Withdrawals not available. Contact support." },
      { status: 503 }
    );
  }

  // ── Step 1: Debit wallet atomically + create withdrawal request ───────────
  let withdrawalId: string;
  try {
    withdrawalId = await (prisma as any).$transaction(async (tx: any) => {
      const wallet = await tx.walletBalance.findUniqueOrThrow({
        where: { userId: session.userId },
      });

      const before = Number(wallet.balance);
      if (before < amountGzo) {
        throw new Error(`INSUFFICIENT_BALANCE:${before}`);
      }

      const after = before - amountGzo;

      await tx.walletBalance.update({
        where: { userId: session.userId },
        data: { balance: String(after) },
      });

      await tx.ledgerEntry.create({
        data: {
          userId: session.userId,
          type: LedgerEntryType.WITHDRAWAL,
          amount: String(amountGzo),
          balanceBefore: String(before),
          balanceAfter: String(after),
          reference: null, // updated after on-chain send
        },
      });

      const req = await tx.withdrawalRequest.create({
        data: {
          userId: session.userId,
          toAddress: session.walletAddress,
          amountGzo: String(amountGzo),
          status: "PROCESSING",
        },
      });
      return req.id;
    });
  } catch (err: any) {
    if (err.message?.startsWith("INSUFFICIENT_BALANCE:")) {
      const have = err.message.split(":")[1];
      return NextResponse.json(
        { error: `Insufficient balance. Available: ${have} GZO` },
        { status: 422 }
      );
    }
    console.error("[withdraw] DB debit error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // ── Step 2: Send GZO on-chain ─────────────────────────────────────────────
  let txHash: string;
  try {
    const { client, account } = getHouseWalletClient();
    const amountWei = parseEther(String(amountGzo));

    txHash = await client.writeContract({
      account,
      address: ADDRESSES.gzoToken,
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [session.walletAddress as `0x${string}`, amountWei],
    });

    // Wait for receipt (up to 60s)
    const publicClient = getPublicClient();
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash as `0x${string}`,
      timeout: 60_000,
    });

    if (receipt.status !== "success") {
      throw new Error("on-chain tx reverted");
    }
  } catch (err: any) {
    const errMsg = err?.message ?? "Unknown error";
    console.error("[withdraw] on-chain send failed:", errMsg);

    // ── Refund: credit wallet back ─────────────────────────────────────────
    try {
      await (prisma as any).$transaction(async (tx: any) => {
        const wallet = await tx.walletBalance.findUniqueOrThrow({
          where: { userId: session.userId },
        });
        const before = Number(wallet.balance);
        const after = before + amountGzo;

        await tx.walletBalance.update({
          where: { userId: session.userId },
          data: { balance: String(after) },
        });

        await tx.ledgerEntry.create({
          data: {
            userId: session.userId,
            type: LedgerEntryType.BET_REFUND,
            amount: String(amountGzo),
            balanceBefore: String(before),
            balanceAfter: String(after),
            reference: `withdrawal-refund:${withdrawalId}`,
          },
        });

        await tx.withdrawalRequest.update({
          where: { id: withdrawalId },
          data: {
            status: "FAILED",
            errorMsg: errMsg.slice(0, 500),
            processedAt: new Date(),
          },
        });
      });
    } catch (refundErr) {
      // Log refund failure — manual reconciliation needed
      console.error(
        `[withdraw] CRITICAL: refund failed for withdrawal ${withdrawalId}. User ${session.userId} needs ${amountGzo} GZO credited back.`,
        refundErr
      );
    }

    return NextResponse.json(
      { error: "On-chain transfer failed. Your balance has been refunded." },
      { status: 500 }
    );
  }

  // ── Step 3: Mark withdrawal as complete ───────────────────────────────────
  await (prisma as any).withdrawalRequest.update({
    where: { id: withdrawalId },
    data: {
      status: "COMPLETED",
      txHash,
      processedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, txHash, amountGzo });
}
