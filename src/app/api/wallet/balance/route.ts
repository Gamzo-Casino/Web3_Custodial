/**
 * GET /api/wallet/balance
 * Returns the authenticated user's custodial GZO balance from the database.
 * This is the balance used for all in-app gameplay — NOT the on-chain wallet balance.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/walletSession";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const wallet = await (prisma as any).walletBalance.findUnique({
      where: { userId: session.userId },
    });

    return NextResponse.json({
      balance: wallet ? Number(wallet.balance) : 0,
      userId: session.userId,
    });
  } catch (err) {
    console.error("[wallet/balance] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
