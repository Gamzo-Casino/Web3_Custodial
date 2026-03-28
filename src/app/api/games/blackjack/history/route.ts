import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardFromIndex, handValue } from "@/lib/blackjack";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rounds = await (prisma as any).blackjackRound.findMany({
      where: { userId, status: "SETTLED" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        stakeGzo: true,
        mainStakeGzo: true,
        splitStakeGzo: true,
        mainOutcome: true,
        splitOutcome: true,
        playerCards: true,
        dealerCards: true,
        splitCards: true,
        grossPayoutGzo: true,
        profitGzo: true,
        feeGzo: true,
        netPayoutGzo: true,
        serverSeedHash: true,
        clientSeed: true,
        nonce: true,
        publicSeed: true,
        createdAt: true,
        settledAt: true,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const normalized = rounds.map((r: any) => {
      const playerValues: number[] = JSON.parse(r.playerCards as string);
      const dealerValues: number[] = JSON.parse(r.dealerCards as string);
      const splitValues: number[] | null = r.splitCards ? JSON.parse(r.splitCards as string) : null;

      return {
        id: r.id,
        stakeGzo:      Number(r.stakeGzo),
        mainStakeGzo:  Number(r.mainStakeGzo),
        splitStakeGzo: r.splitStakeGzo != null ? Number(r.splitStakeGzo) : null,
        mainOutcome:   r.mainOutcome,
        splitOutcome:  r.splitOutcome,
        playerTotal:   handValue(playerValues.map(cardFromIndex)),
        dealerTotal:   handValue(dealerValues.map(cardFromIndex)),
        splitTotal:    splitValues ? handValue(splitValues.map(cardFromIndex)) : null,
        grossPayoutGzo: r.grossPayoutGzo != null ? Number(r.grossPayoutGzo) : null,
        profitGzo:     r.profitGzo     != null ? Number(r.profitGzo)     : null,
        feeGzo:        r.feeGzo        != null ? Number(r.feeGzo)        : null,
        netPayoutGzo:  r.netPayoutGzo  != null ? Number(r.netPayoutGzo)  : null,
        serverSeedHash: r.serverSeedHash,
        clientSeed:    r.clientSeed,
        nonce:         r.nonce,
        createdAt:     r.createdAt.toISOString(),
      };
    });

    return NextResponse.json({ rounds: normalized });
  } catch (err) {
    console.error("blackjack/history error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
