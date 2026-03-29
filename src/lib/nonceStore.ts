import { randomBytes } from "crypto";

const TTL_MS = 5 * 60 * 1000; // 5 minutes

interface NonceEntry {
  nonce: string;
  expiresAt: number;
}

// Persist on globalThis so Next.js hot-reloads don't wipe the store mid-flow.
// In production replace with Redis for multi-instance safety.
const g = globalThis as unknown as { __nonceStore?: Map<string, NonceEntry> };
if (!g.__nonceStore) g.__nonceStore = new Map();
const store = g.__nonceStore;

/**
 * generateNonce — creates a fresh 32-hex-char nonce for an address,
 * overwriting any previous pending nonce (so each call invalidates the last).
 */
export function generateNonce(address: string): string {
  const nonce = randomBytes(16).toString("hex");
  store.set(address.toLowerCase(), {
    nonce,
    expiresAt: Date.now() + TTL_MS,
  });
  return nonce;
}

/**
 * consumeNonce — verifies the nonce exists, is not expired, and matches.
 * Deletes it on success (one-time use).
 * Returns true on success, false on any failure (missing, expired, mismatch).
 */
export function consumeNonce(address: string, nonce: string): boolean {
  const key = address.toLowerCase();
  const entry = store.get(key);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return false;
  }
  if (entry.nonce !== nonce) return false;
  store.delete(key);
  return true;
}
