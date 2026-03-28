import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

// In-memory nonce store (replace with Redis/DB for multi-instance prod)
const nonceStore = new Map<string, { nonce: string; expiresAt: number }>();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address")?.toLowerCase();
  if (!address || !/^0x[0-9a-f]{40}$/i.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const nonce = randomBytes(16).toString("hex");
  nonceStore.set(address, { nonce, expiresAt: Date.now() + 5 * 60_000 }); // 5 min TTL

  const domain   = process.env.NEXTAUTH_URL?.replace(/^https?:\/\//, "") ?? "localhost:3000";
  const origin   = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const chainId  = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "31337");
  const issuedAt = new Date().toISOString();

  const message = [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Sign in to Gamzo — Provably Fair Games",
    "",
    `URI: ${origin}`,
    `Version: 1`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");

  return NextResponse.json({ nonce, message });
}

/** Internal — called by /verify to consume a nonce */
export function consumeNonce(address: string, nonce: string): boolean {
  const addr = address.toLowerCase();
  const entry = nonceStore.get(addr);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) { nonceStore.delete(addr); return false; }
  if (entry.nonce !== nonce) return false;
  nonceStore.delete(addr);
  return true;
}
