import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = authUser.userId;
  const { searchParams } = new URL(request.url);
  const typeFilter = searchParams.get("type")?.toUpperCase() ?? "ALL"; // ALL | DEPOSIT | WITHDRAWAL
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const skip = (page - 1) * PAGE_SIZE;

  try {
    let rows: ReturnType<typeof normalizeDeposit | typeof normalizeWithdrawal>[] = [];
    let total = 0;

    if (typeFilter === "DEPOSIT") {
      const where = { userId };
      const [deposits, count] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).deposit.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: PAGE_SIZE,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).deposit.count({ where }),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rows  = deposits.map((d: any) => normalizeDeposit(d));
      total = count;

    } else if (typeFilter === "WITHDRAWAL") {
      const where = { userId };
      const [withdrawals, count] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).withdrawalRequest.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: PAGE_SIZE,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).withdrawalRequest.count({ where }),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rows  = withdrawals.map((w: any) => normalizeWithdrawal(w));
      total = count;

    } else {
      // ALL — fetch both, merge & sort in memory (paginate after merge)
      const [deposits, withdrawals, dCount, wCount] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).deposit.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 5000,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).withdrawalRequest.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 5000,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).deposit.count({ where: { userId } }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).withdrawalRequest.count({ where: { userId } }),
      ]);

      const all = [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...deposits.map((d: any) => normalizeDeposit(d)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...withdrawals.map((w: any) => normalizeWithdrawal(w)),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      total = dCount + wCount;
      rows  = all.slice(skip, skip + PAGE_SIZE);
    }

    return NextResponse.json({
      transactions: rows,
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });

  } catch (err) {
    console.error("history/transactions error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ── Normalizers ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeDeposit(d: any) {
  return {
    id:          d.id,
    type:        "DEPOSIT" as const,
    amountGzo:   Number(d.amountGzo),
    status:      d.status as string,
    txHash:      d.txHash      ?? null,
    chainId:     80002, // Amoy — deposits are always on-chain
    address:     d.fromAddress ?? null, // sender address
    adminNote:   d.adminNote   ?? null,
    createdAt:   d.createdAt.toISOString(),
    settledAt:   d.confirmedAt?.toISOString() ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeWithdrawal(w: any) {
  return {
    id:          w.id,
    type:        "WITHDRAWAL" as const,
    amountGzo:   Number(w.amountGzo),
    status:      w.status as string,
    txHash:      w.txHash    ?? null,
    chainId:     80002,
    address:     w.toAddress ?? null, // recipient address
    adminNote:   w.adminNote ?? null,
    errorMsg:    w.errorMsg  ?? null,
    createdAt:   w.createdAt.toISOString(),
    settledAt:   w.processedAt?.toISOString() ?? null,
  };
}
