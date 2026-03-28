"use client";

import { useState, useEffect } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { TARGET_CHAIN_ID } from "@/lib/web3/config";
import { ConnectButton } from "@rainbow-me/rainbowkit";

interface Props {
  children: React.ReactNode;
  requireConnected?: boolean;
}

export default function NetworkGuard({ children, requireConnected = true }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  // Render children on server (and before hydration) so SSR HTML matches
  if (!mounted) return <>{children}</>;

  if (!isConnected && requireConnected) {
    return (
      <div style={{
        textAlign: "center",
        padding: "4rem 2rem",
        background: "#0d0d1a",
        border: "1px solid #2a2a50",
        borderRadius: "16px",
      }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🔐</div>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 800, color: "#f0f0ff", marginBottom: "0.5rem" }}>
          Connect Your Wallet
        </h2>
        <p style={{ color: "#8888aa", fontSize: "0.9rem", marginBottom: "1.75rem", maxWidth: "320px", margin: "0 auto 1.75rem" }}>
          Connect a wallet to play Gamzo. Your GZO balance will be loaded automatically.
        </p>
        <ConnectButton label="Connect Wallet" />
      </div>
    );
  }

  if (isConnected && chainId !== TARGET_CHAIN_ID) {
    const networkName = TARGET_CHAIN_ID === 80002 ? "Polygon Amoy" : "Hardhat Local";
    return (
      <div style={{
        textAlign: "center",
        padding: "4rem 2rem",
        background: "rgba(255,77,77,0.05)",
        border: "1px solid rgba(255,77,77,0.2)",
        borderRadius: "16px",
      }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>⛓️</div>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 800, color: "#f0f0ff", marginBottom: "0.5rem" }}>
          Wrong Network
        </h2>
        <p style={{ color: "#8888aa", fontSize: "0.9rem", marginBottom: "1.75rem" }}>
          Gamzo runs on <strong style={{ color: "#00ff9d" }}>{networkName}</strong>.
          Please switch networks to continue.
        </p>
        <button
          onClick={() => switchChain({ chainId: TARGET_CHAIN_ID })}
          disabled={isPending}
          style={{
            padding: "0.75rem 2rem",
            borderRadius: "10px",
            background: "rgba(255,77,77,0.15)",
            border: "1px solid rgba(255,77,77,0.4)",
            color: "#ff8080",
            fontSize: "1rem",
            fontWeight: 700,
            cursor: isPending ? "default" : "pointer",
            opacity: isPending ? 0.6 : 1,
          }}
        >
          {isPending ? "Switching…" : `Switch to ${networkName}`}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
