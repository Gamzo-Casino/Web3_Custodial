/**
 * GET  /api/fairness/seeds  — return current player's public seed state
 * POST /api/fairness/seeds  — update player's client seed
 *
 * The raw serverSeed is NEVER returned. Only the SHA-256 commitment hash is
 * exposed so players can verify their next bet before it's placed.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSeedStatePublic, setClientSeed } from "@/lib/seedManager";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const state = await getSeedStatePublic(session.user.id);
    return NextResponse.json(state);
  } catch (err) {
    console.error("fairness/seeds GET error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

const updateSchema = z.object({
  clientSeed: z.string().min(1).max(128),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof updateSchema>;
  try {
    body = updateSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    await setClientSeed(session.user.id, body.clientSeed);
    const state = await getSeedStatePublic(session.user.id);
    return NextResponse.json({ ok: true, ...state });
  } catch (err) {
    console.error("fairness/seeds POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
