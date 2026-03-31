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
  const key = address.toLowerCase();

  await (prisma as any).walletNonce.upsert({
    where:  { address: key },
    update: { nonce, expiresAt },
    create: { address: key, nonce, expiresAt },
  });

  return nonce;
}

/**
 * consumeNonce — verifies the nonce matches and is not expired, then deletes it.
 * Returns true on success, false on any failure.
 */
export async function consumeNonce(address: string, nonce: string): Promise<boolean> {
  const key = address.toLowerCase();

  let entry: { nonce: string; expiresAt: Date } | null = null;
  try {
    entry = await (prisma as any).walletNonce.findUnique({ where: { address: key } });
  } catch (err) {
    console.error("[nonceStore] DB error in consumeNonce:", err);
    return false;
  }

  if (!entry) {
    console.warn("[nonceStore] no nonce found for", key);
    return false;
  }
  if (entry.expiresAt < new Date()) {
    console.warn("[nonceStore] nonce expired for", key);
    await (prisma as any).walletNonce.delete({ where: { address: key } }).catch(() => {});
    return false;
  }
  if (entry.nonce !== nonce) {
    console.warn("[nonceStore] nonce mismatch for", key, "— expected", entry.nonce, "got", nonce);
    return false;
  }

  await (prisma as any).walletNonce.delete({ where: { address: key } }).catch(() => {});
  return true;
}
