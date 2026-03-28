/**
 * Protected admin route — House Treasury management.
 *
 * Authentication: Bearer token must equal AUTH_SECRET (env var).
 * In production: also requires NODE_ENV check to prevent accidental exposure.
 *
 * GET  /api/admin/treasury        — returns balance + recent ledger
 * POST /api/admin/treasury        — top-up treasury { amountGzo: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  HOUSE_ID,
  creditHouseTx,
  HouseLedgerType,
  getHouseBalance,
  getHouseLedger,
} from "@/lib/house";
import { z } from "zod";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const secret = process.env.AUTH_SECRET ?? "";
  return token === secret && token.length >= 16;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const balance = await getHouseBalance();
    const ledger = await getHouseLedger(50);

    return NextResponse.json({
      houseId: HOUSE_ID,
      balanceGzo: balance,
      ledger: ledger.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => ({
          id: e.id,
          type: e.type,
          amountGzo: Number(e.amountGzo),
          balanceBefore: Number(e.balanceBefore),
          balanceAfter: Number(e.balanceAfter),
          reference: e.reference,
          createdAt: e.createdAt,
        })
      ),
    });
  } catch (err) {
    console.error("admin/treasury GET error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

const topupSchema = z.object({
  amountGzo: z.number().int().min(1).max(10_000_000),
  note: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Extra guard: topup only allowed outside production
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Treasury topup not available in production" },
      { status: 403 }
    );
  }

  let body: z.infer<typeof topupSchema>;
  try {
    body = topupSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { amountGzo, note } = body;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newBalance = await (prisma as any).$transaction(async (tx: any) => {
      return creditHouseTx(tx, amountGzo, HouseLedgerType.TOPUP, note ?? "admin-topup");
    });

    return NextResponse.json({ ok: true, newBalanceGzo: newBalance });
  } catch (err) {
    console.error("admin/treasury POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
