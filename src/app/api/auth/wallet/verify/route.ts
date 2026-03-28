import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { consumeNonce } from "../nonce/route";
import { signIn } from "@/lib/auth";

const schema = z.object({
  address:   z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  message:   z.string().min(10),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const { address, message, signature } = parsed.data;

  // 1. Verify the SIWE signature
  let valid = false;
  try {
    valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  // 2. Extract and consume nonce from the message
  const nonceMatch = message.match(/Nonce: ([a-f0-9]+)/);
  const nonce = nonceMatch?.[1];
  if (!nonce) return NextResponse.json({ error: "Missing nonce" }, { status: 400 });
  if (!consumeNonce(address, nonce)) {
    return NextResponse.json({ error: "Nonce invalid or expired" }, { status: 401 });
  }

  // 3. Upsert user keyed by wallet address
  const walletAddress = address.toLowerCase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let user = await (prisma as any).user.findFirst({ where: { walletAddress } });

  if (!user) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user = await (prisma as any).user.create({
      data: {
        walletAddress,
        name: `${address.slice(0, 6)}…${address.slice(-4)}`,
        email: `${walletAddress}@wallet.gamzo`, // placeholder — not used for auth
        updatedAt: new Date(),
      },
    });
    // Bootstrap wallet balance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).walletBalance.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, balance: "0" },
    });
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).user.update({ where: { id: user.id }, data: { updatedAt: new Date() } });
  }

  // 4. Use NextAuth signIn to create the session (returns a redirect but we want JSON)
  // Instead, return the user id so the client can call signIn("credentials", ...)
  // with a special wallet-session token
  return NextResponse.json({ ok: true, userId: user.id, address: walletAddress });
}
