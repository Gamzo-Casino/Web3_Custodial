import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matches = await (prisma as any).coinflipMatch.findMany({
      where: {
        OR: [{ playerAId: userId }, { playerBId: userId }],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        playerA: { select: { id: true, name: true, email: true } },
        playerB: { select: { id: true, name: true, email: true } },
      },
    });

    return NextResponse.json({ matches });
  } catch (err) {
    console.error("coinflip/history error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
