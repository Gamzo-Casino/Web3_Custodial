import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rounds = await (prisma as any).wheelRound.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        stakeGzo: true,
        riskMode: true,
        segmentLabel: true,
        landedMultiplier: true,
        grossPayoutGzo: true,
        profitGzo: true,
        netPayoutGzo: true,
        serverSeedHash: true,
        nonce: true,
        createdAt: true,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const history = rounds.map((r: any) => ({
      id: r.id,
      stakeGzo:         Number(r.stakeGzo),
      riskMode:         r.riskMode,
      segmentLabel:     r.segmentLabel,
      landedMultiplier: Number(r.landedMultiplier),
      grossPayoutGzo:   Number(r.grossPayoutGzo),
      profitGzo:        Number(r.profitGzo),
      netPayoutGzo:     Number(r.netPayoutGzo),
      won:              Number(r.grossPayoutGzo) > 0,
      serverSeedHash:   r.serverSeedHash,
      nonce:            r.nonce,
      createdAt:        r.createdAt,
    }));

    return NextResponse.json({ history });
  } catch (err) {
    console.error("wheel/history error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
