/**
 * POST /api/fairness/seeds/rotate
 *
 * Rotates the player's active server seed.
 *
 * IMPORTANT: This endpoint is only safe to call when the player has NO
 * currently pending bets that use the old server seed. Rotating mid-game
 * would invalidate the commitment for any open match.
 *
 * Response:
 *   { ok: true, revealedSeed, newServerSeedHash, clientSeed, nonce }
 *
 * The revealedSeed is the old server seed (now public). Players can verify
 * SHA-256(revealedSeed) === their previous serverSeedHash.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rotateSeedTx, getSeedStatePublic } from "@/lib/seedManager";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { revealedSeed } = await (prisma as any).$transaction(async (tx: any) => {
      return rotateSeedTx(tx, userId);
    });

    // Return new public state + the revealed old seed
    const newState = await getSeedStatePublic(userId);
    return NextResponse.json({
      ok: true,
      revealedSeed,
      ...newState,
    });
  } catch (err) {
    console.error("fairness/seeds/rotate POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
