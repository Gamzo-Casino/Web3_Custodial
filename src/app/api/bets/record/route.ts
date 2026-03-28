import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/walletSession";
import { prisma } from "@/lib/prismaClient";

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    gameType: string;
    onchainRoundId: string;
    txHash: string;
    stakeGzo: number;
    netPayoutGzo: number;
    won: boolean;
    resultJson: object;
    contractAddress?: string;
    chainId?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    gameType,
    onchainRoundId,
    txHash,
    stakeGzo,
    netPayoutGzo,
    resultJson,
    contractAddress,
    chainId,
  } = body;

  if (!gameType || !onchainRoundId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const idempotencyKey = `${gameType}:${onchainRoundId}`;
  const userId = session.userId;

  try {
    const bet = await (prisma as any).gameBet.upsert({
      where: { idempotencyKey },
      update: {},
      create: {
        userId,
        gameType,
        stakeGzo: String(stakeGzo),
        status: "SETTLED",
        idempotencyKey,
        settledAt: new Date(),
        onchainRoundId,
        txHash,
        netPayoutGzo: String(netPayoutGzo),
        profitGzo: String(netPayoutGzo - stakeGzo),
        chainId: chainId ?? 31337,
        contractAddress: contractAddress ?? "",
        resultJson,
      },
    });

    return NextResponse.json({ ok: true, bet: { id: bet.id, idempotencyKey: bet.idempotencyKey } });
  } catch (err: any) {
    console.error("[bets/record] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
