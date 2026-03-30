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
  const gameFilter = searchParams.get("game")?.toUpperCase() ?? null;
  const page       = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const skip       = (page - 1) * PAGE_SIZE;

  const isCoinflipOnly = gameFilter === "COINFLIP";
  const isSoloGame     = gameFilter && gameFilter !== "COINFLIP";

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bets: any[];
    let total: number;

    if (isSoloGame) {
      const where = { userId, gameType: gameFilter as string };
      const [rows, count] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).gameBet.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: PAGE_SIZE,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).gameBet.count({ where }),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bets  = rows.map((b: any) => normalizeSoloBet(b));
      total = count;

    } else if (isCoinflipOnly) {
      const where = { OR: [{ playerAId: userId }, { playerBId: userId }] };
      const [rows, count] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).coinflipMatch.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: PAGE_SIZE,
          include: {
            playerA: { select: { id: true, name: true, email: true } },
            playerB: { select: { id: true, name: true, email: true } },
            commits: { where: { userId } },
          },
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).coinflipMatch.count({ where }),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bets  = rows.map((m: any) => normalizeCoinflip(m, userId));
      total = count;

    } else {
      // ALL games — fetch both tables, merge, sort, paginate in memory
      const [gameBetRows, coinflipRows, gameBetCount, coinflipCount] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).gameBet.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 5000,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).coinflipMatch.findMany({
          where: { OR: [{ playerAId: userId }, { playerBId: userId }] },
          orderBy: { createdAt: "desc" },
          take: 5000,
          include: {
            playerA: { select: { id: true, name: true, email: true } },
            playerB: { select: { id: true, name: true, email: true } },
            commits: { where: { userId } },
          },
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).gameBet.count({ where: { userId } }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).coinflipMatch.count({
          where: { OR: [{ playerAId: userId }, { playerBId: userId }] },
        }),
      ]);

      const all = [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...gameBetRows.map((b: any) => normalizeSoloBet(b)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...coinflipRows.map((m: any) => normalizeCoinflip(m, userId)),
      ].sort((a, b) => {
        const pa = ["PENDING", "ACTIVE"].includes(a.status);
        const pb = ["PENDING", "ACTIVE"].includes(b.status);
        if (pa !== pb) return pa ? -1 : 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      total = gameBetCount + coinflipCount;
      bets  = all.slice(skip, skip + PAGE_SIZE);
    }

    return NextResponse.json({
      bets,
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });

  } catch (err) {
    console.error("history error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ── Normalizers ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeSoloBet(b: any) {
  return {
    id:                 b.id,
    game:               b.gameType as string,
    status:             b.status as string,
    stakeGzo:           Number(b.stakeGzo),
    netPayoutGzo:       b.netPayoutGzo  != null ? Number(b.netPayoutGzo)  : null,
    profitGzo:          b.profitGzo     != null ? Number(b.profitGzo)     : null,
    createdAt:          b.createdAt.toISOString(),
    settledAt:          b.settledAt?.toISOString() ?? null,
    referenceId:        b.referenceId   ?? null,
    serverSeedHash:     b.serverSeedHash      ?? null,
    serverSeedRevealed: b.serverSeedRevealed  ?? null,
    clientSeed:         b.clientSeed    ?? null,
    nonce:              b.nonce         ?? null,
    publicSeed:         b.publicSeed    ?? null,
    resultJson:         b.resultJson    ?? null,
    txHash:             b.txHash        ?? null,
    onchainRoundId:     b.onchainRoundId ?? null,
    chainId:            b.chainId       ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeCoinflip(m: any, userId: string) {
  const isA       = m.playerAId === userId;
  const myChoice  = isA ? m.playerAChoice : (m.playerAChoice === "HEADS" ? "TAILS" : "HEADS");
  const won       = m.winnerId === userId;
  const completed = m.status === "COMPLETED";
  const wager     = Number(m.wager);
  const commit    = m.commits[0] ?? null;
  const opponent  = isA ? m.playerB : m.playerA;

  return {
    id:                 m.id,
    game:               "COINFLIP",
    status:             m.status as string,
    stakeGzo:           wager,
    netPayoutGzo:       completed ? (won ? Math.floor(wager * 2 * 0.99) : 0) : null,
    profitGzo:          completed ? (won ? Math.floor(wager * 2 * 0.99) - wager : -wager) : null,
    createdAt:          m.createdAt.toISOString(),
    settledAt:          m.resolvedAt?.toISOString() ?? null,
    referenceId:        m.id,
    serverSeedHash:     commit?.commitHash ?? null,
    serverSeedRevealed: commit?.seed       ?? null,
    clientSeed:         null,
    nonce:              null,
    publicSeed:         null,
    resultJson: {
      outcome:      m.outcome ?? null,
      myChoice,
      won:          completed ? won : null,
      opponentName: opponent ? (opponent.name ?? opponent.email?.split("@")[0] ?? "Player") : "Waiting…",
    },
  };
}
