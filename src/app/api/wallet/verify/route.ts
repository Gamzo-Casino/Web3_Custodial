import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { consumeNonce } from "@/lib/nonceStore";
import { createSession } from "@/lib/walletSession";
import { prisma } from "@/lib/prismaClient";

/** Parse our hand-built EIP-4361 SIWE message string. */
function parseSiweMessage(raw: string): {
  address: string;
  nonce: string;
  chainId: number;
  domain: string;
} | null {
  try {
    const lines = raw.split("\n");
    // Line 1: "<domain> wants you to sign in with your Ethereum account:"
    const domain = lines[0]?.split(" wants you to")[0] ?? "";
    // Line 1 (0-indexed): address
    const address = lines[1]?.trim() ?? "";
    const nonceLine = lines.find((l) => l.startsWith("Nonce: "));
    const chainLine = lines.find((l) => l.startsWith("Chain ID: "));
    if (!nonceLine || !chainLine) return null;
    const nonce = nonceLine.replace("Nonce: ", "").trim();
    const chainId = parseInt(chainLine.replace("Chain ID: ", "").trim(), 10);
    return { address, nonce, chainId, domain };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { message: rawMessage, signature } = body as Record<string, unknown>;
  if (typeof rawMessage !== "string" || typeof signature !== "string") {
    return NextResponse.json({ error: "message and signature are required" }, { status: 400 });
  }

  // Parse the SIWE message
  const parsed = parseSiweMessage(rawMessage);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid SIWE message format" }, { status: 400 });
  }
  const { address, nonce, chainId } = parsed;

  // Verify the EIP-191 signature using viem
  let isValid = false;
  try {
    isValid = await verifyMessage({
      address: address as `0x${string}`,
      message: rawMessage,
      signature: signature as `0x${string}`,
    });
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Consume the nonce (one-time use, TTL-checked)
  if (!await consumeNonce(address, nonce)) {
    return NextResponse.json({ error: "Nonce reused or expired" }, { status: 401 });
  }

  const walletAddress = address.toLowerCase();

  // Upsert user keyed by wallet address
  let user: Record<string, unknown>;
  try {
    user = await prisma.user.findFirst({ where: { walletAddress } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          walletAddress,
          name: `${address.slice(0, 6)}...${address.slice(-4)}`,
          chainId: chainId ?? null,
          lastSeenAt: new Date(),
        },
      });
      // Bootstrap wallet balance
      await prisma.walletBalance.upsert({
        where: { userId: (user as any).id },
        update: {},
        create: { userId: (user as any).id, balance: "0" },
      });
    } else {
      user = await prisma.user.update({
        where: { id: (user as any).id },
        data: { lastSeenAt: new Date(), chainId: chainId ?? undefined },
      });
    }
  } catch (err) {
    console.error("[wallet/verify] DB error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const response = NextResponse.json({
    user: {
      id: (user as any).id,
      walletAddress: (user as any).walletAddress,
      name: (user as any).name,
      email: (user as any).email,
    },
  });

  await createSession(walletAddress, (user as any).id, response);

  return response;
}
