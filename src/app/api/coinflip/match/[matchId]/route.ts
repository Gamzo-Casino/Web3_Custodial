import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computePublicSeed } from "@/lib/coinflip";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const match = await (prisma as any).coinflipMatch.findUnique({
      where: { id: matchId },
      include: {
        playerA: { select: { id: true, name: true, email: true } },
        playerB: { select: { id: true, name: true, email: true } },
        commits: true,
      },
    });

    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    // Build safe response — only expose serverSeed after resolution (revealedAt set)
    const commitA = match.commits.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c.userId === match.playerAId
    );
    const commitB = match.commits.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c.userId === match.playerBId
    );

    const revealed = commitA?.revealedAt != null;

    const publicSeed =
      match.playerBId ? computePublicSeed(matchId, match.playerBId) : null;

    // Fetch nonce from Player A's GameBet (snapshotted at create time)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gameBetA = await (prisma as any).gameBet.findUnique({
      where: { idempotencyKey: `${matchId}:${match.playerAId}` },
      select: { nonce: true },
    });

    return NextResponse.json({
      match: {
        id: match.id,
        status: match.status,
        wager: Number(match.wager),
        playerAChoice: match.playerAChoice,
        outcome: match.outcome,
        winnerId: match.winnerId,
        createdAt: match.createdAt,
        resolvedAt: match.resolvedAt,
        playerA: match.playerA,
        playerB: match.playerB,
        commitHash: commitA?.commitHash ?? null,
        // Only expose serverSeed after the match is resolved
        serverSeed: revealed ? commitA?.seed ?? null : null,
        clientSeed: commitB?.seed ?? null,
        publicSeed,
        nonce: gameBetA?.nonce ?? 0,
      },
    });
  } catch (err) {
    console.error("coinflip/match error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
