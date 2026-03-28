"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useWalletAuth, type WalletAuthState } from "@/lib/web3/hooks/useWalletAuth";

export const WalletAuthContext = createContext<WalletAuthState | null>(null);

export function WalletAuthProvider({ children }: { children: ReactNode }) {
  const auth = useWalletAuth();
  return (
    <WalletAuthContext.Provider value={auth}>{children}</WalletAuthContext.Provider>
  );
}

export function useWalletUser(): WalletAuthState {
  const ctx = useContext(WalletAuthContext);
  if (!ctx) throw new Error("useWalletUser must be used inside WalletAuthProvider");
  return ctx;
}
