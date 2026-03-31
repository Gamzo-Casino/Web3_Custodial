import { NextResponse } from "next/server";
import { generateNonce } from "@/lib/nonceStore";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("address");
  if (!raw || !ADDRESS_RE.test(raw)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    const address = raw.toLowerCase();
    const nonce = await generateNonce(address);
    return NextResponse.json({ nonce });
  } catch (err) {
    console.error("[wallet/nonce] error:", err);
    return NextResponse.json({ error: "Failed to get nonce" }, { status: 500 });
  }
}
