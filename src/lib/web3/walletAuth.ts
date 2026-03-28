/**
 * Wallet-based auth flow:
 * 1. User connects wallet (RainbowKit)
 * 2. Frontend calls GET /api/auth/wallet/nonce?address=0x…
 * 3. Backend creates a SIWE message + nonce, returns it
 * 4. Frontend asks wallet to sign the message
 * 5. Frontend POSTs { address, message, signature } to /api/auth/wallet/verify
 * 6. Backend verifies signature, upserts DB user keyed by walletAddress, returns JWT
 * 7. NextAuth session carries the wallet address as user.id
 */

export async function fetchWalletNonce(address: string): Promise<{ nonce: string; message: string }> {
  const res = await fetch(`/api/auth/wallet/nonce?address=${address}`);
  if (!res.ok) throw new Error("Failed to get nonce");
  return res.json();
}

export async function verifyWalletSignature(
  address: string,
  message: string,
  signature: string
): Promise<{ ok: boolean; token?: string }> {
  const res = await fetch("/api/auth/wallet/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, message, signature }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Signature verification failed");
  }
  return res.json();
}

export function buildSIWEMessage({
  address,
  nonce,
  chainId,
}: {
  address: string;
  nonce: string;
  chainId: number;
}): string {
  const domain  = typeof window !== "undefined" ? window.location.host : "gamzo.app";
  const origin  = typeof window !== "undefined" ? window.location.origin : "https://gamzo.app";
  const issuedAt = new Date().toISOString();
  return [
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
}
