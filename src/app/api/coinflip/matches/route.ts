import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matches = await (prisma as any).coinflipMatch.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        playerA: { select: { id: true, name: true, email: true } },
      },
    });

    return NextResponse.json({ matches });
  } catch (err) {
    console.error("coinflip/matches error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
