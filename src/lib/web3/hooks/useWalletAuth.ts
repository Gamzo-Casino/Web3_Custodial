"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAccount, useSignMessage, useDisconnect } from "wagmi";

/** Build an EIP-4361 SIWE message string without the `siwe` package. */
function buildSiweMessage(params: {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
}): string {
  return [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    params.address,
    "",
    params.statement,
    "",
    `URI: ${params.uri}`,
    `Version: ${params.version}`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
  ].join("\n");
}

export interface WalletUser {
  id: string;
  walletAddress: string;
  name: string | null;
  email: string | null;
  createdAt?: string;
}

export interface WalletAuthState {
  user: WalletUser | null;
  isLoading: boolean;
  isSigning: boolean;
  error: string | null;
  refetchUser: () => Promise<void>;
}

export function useWalletAuth(): WalletAuthState {
  const { address, chain, isConnected, status: wagmiStatus } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();

  const [user, setUser] = useState<WalletUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track which address we have an active session for
  const sessionAddressRef = useRef<string | undefined>(undefined);
  // Prevent concurrent sign-in flows
  const signingRef = useRef(false);
  // Only true after wagmi has connected with the matching session address.
  // We gate auto-logout on this so page-load reconnection never triggers a logout.
  const fullyAuthenticatedRef = useRef(false);

  const fetchUser = useCallback(async (): Promise<WalletUser | null> => {
    try {
      const res = await fetch("/api/wallet/me");
      if (!res.ok) return null;
      const data = await res.json();
      return data.user ?? null;
    } catch {
      return null;
    }
  }, []);

  const refetchUser = useCallback(async () => {
    const u = await fetchUser();
    setUser(u);
  }, [fetchUser]);

  const doLogout = useCallback(async () => {
    try {
      await fetch("/api/wallet/logout", { method: "POST" });
    } catch {
      // best-effort
    }
    setUser(null);
    sessionAddressRef.current = undefined;
    fullyAuthenticatedRef.current = false;
  }, []);

  const doSignIn = useCallback(
    async (addr: string) => {
      if (signingRef.current) return;
      signingRef.current = true;
      setIsSigning(true);
      setError(null);

      try {
        // 1. Get nonce
        const nonceRes = await fetch(`/api/wallet/nonce?address=${addr}`);
        if (!nonceRes.ok) {
          const err = await nonceRes.json().catch(() => ({}));
          if (nonceRes.status === 401) {
            // nonce expired — retry handled by re-trigger on address change
            setError(err.error ?? "Nonce expired, please try again");
          } else {
            setError(err.error ?? "Failed to get nonce");
          }
          return;
        }
        const { nonce } = await nonceRes.json();

        // 2. Build SIWE message
        const prepared = buildSiweMessage({
          domain: window.location.host,
          address: addr,
          statement: "Sign in to Gamzo Casino",
          uri: window.location.origin,
          version: "1",
          chainId: chain?.id ?? 80002,
          nonce,
          issuedAt: new Date().toISOString(),
        });

        // 3. Ask wallet to sign
        let signature: string;
        try {
          signature = await signMessageAsync({ message: prepared });
        } catch {
          // User rejected or dismissed
          setError("Sign the message to log in");
          disconnect();
          return;
        }

        // 4. Verify on backend
        const verifyRes = await fetch("/api/wallet/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: prepared, signature }),
        });

        if (!verifyRes.ok) {
          const err = await verifyRes.json().catch(() => ({}));
          setError(err.error ?? "Sign-in failed");
          disconnect();
          return;
        }

        const { user: newUser } = await verifyRes.json();
        setUser(newUser);
        sessionAddressRef.current = addr;
        setError(null);
      } catch {
        setError("Network error during sign-in");
        disconnect();
      } finally {
        setIsSigning(false);
        signingRef.current = false;
      }
    },
    [chain?.id, disconnect, signMessageAsync]
  );

  // On mount: restore session from cookie
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const u = await fetchUser();
      if (!cancelled) {
        if (u) {
          setUser(u);
          sessionAddressRef.current = u.walletAddress;
        }
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchUser]);

  // React to wallet connection changes
  useEffect(() => {
    if (isLoading) return; // wait for initial session restore

    // wagmi is still reconnecting after page refresh — do NOT treat this as
    // a disconnect. Wait until it settles to 'connected' or 'disconnected'.
    if (wagmiStatus === "reconnecting" || wagmiStatus === "connecting") return;

    if (!isConnected || !address) {
      // Only auto-logout if we have previously confirmed a full auth cycle
      // (wagmi connected + session matched). This prevents the page-load race
      // where wagmi starts as 'disconnected' before it reconnects.
      if (fullyAuthenticatedRef.current && sessionAddressRef.current) {
        fullyAuthenticatedRef.current = false;
        doLogout();
      }
      return;
    }

    const lowerAddr = address.toLowerCase();

    if (sessionAddressRef.current && sessionAddressRef.current !== lowerAddr) {
      // Wallet switched to a different address — re-authenticate
      fullyAuthenticatedRef.current = false;
      doLogout().then(() => doSignIn(lowerAddr));
      return;
    }

    if (sessionAddressRef.current === lowerAddr) {
      // Session from cookie + wagmi wallet are aligned — fully authenticated
      fullyAuthenticatedRef.current = true;
      return;
    }

    if (!sessionAddressRef.current) {
      // No session cookie, wallet just connected → start sign-in flow
      doSignIn(lowerAddr);
    }
  }, [address, isConnected, wagmiStatus, isLoading, doLogout, doSignIn]);

  return { user, isLoading, isSigning, error, refetchUser };
}
