import { NextResponse } from "next/server";
import { generateNonce } from "@/lib/nonceStore";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("address");
  if (!raw || !ADDRESS_RE.test(raw)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const address = raw.toLowerCase();
  const nonce = generateNonce(address);
  return NextResponse.json({ nonce });
}
