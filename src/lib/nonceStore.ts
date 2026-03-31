import { randomBytes } from "crypto";
import { prisma } from "@/lib/prismaClient";

const TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * generateNonce — creates a fresh nonce for an address stored in the DB.
 * Works across serverless instances (Netlify, Vercel, etc.)
 */
export async function generateNonce(address: string): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + TTL_MS);

  await (prisma as any).walletNonce.upsert({
    where:  { address: address.toLowerCase() },
    update: { nonce, expiresAt },
    create: { address: address.toLowerCase(), nonce, expiresAt },
  });

  return nonce;
}

/**
 * consumeNonce — verifies the nonce matches and is not expired, then deletes it.
 * Returns true on success, false on any failure.
 */
export async function consumeNonce(address: string, nonce: string): Promise<boolean> {
  const key = address.toLowerCase();

  const entry = await (prisma as any).walletNonce.findUnique({ where: { address: key } });
  if (!entry) return false;
  if (entry.expiresAt < new Date()) {
    await (prisma as any).walletNonce.delete({ where: { address: key } }).catch(() => {});
    return false;
  }
  if (entry.nonce !== nonce) return false;

  await (prisma as any).walletNonce.delete({ where: { address: key } }).catch(() => {});
  return true;
}
