"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useSwitchChain, useDisconnect } from "wagmi";
import { TARGET_CHAIN_ID } from "@/lib/web3/config";
import { useGZOBalance } from "@/lib/web3/hooks/useGZOBalance";
import { useWalletUser } from "@/contexts/WalletAuthContext";
import ProfileModal from "@/components/ProfileModal";
import { useState, useRef, useEffect } from "react";
import type { WalletUser } from "@/lib/web3/hooks/useWalletAuth";

export default function WalletButton() {
  const { isConnected, status: wagmiStatus } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { disconnect } = useDisconnect();
  const wrongNetwork = isConnected && chainId !== TARGET_CHAIN_ID;

  const { user, isLoading: sessionLoading, isSigning, error, refetchUser } = useWalletUser();

  // True while wagmi is still reconnecting to MetaMask after page refresh
  const isReconnecting = wagmiStatus === "reconnecting" || wagmiStatus === "connecting";

  // Prevent SSR/client hydration mismatch — wagmi state is client-only
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [showMenu, setShowMenu] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [localUser, setLocalUser] = useState<WalletUser | null>(null);
  const [errorVisible, setErrorVisible] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Sync local user with context user
  useEffect(() => {
    setLocalUser(user);
  }, [user]);

  // Auto-dismiss error after 5 seconds
  useEffect(() => {
    if (error) {
      setErrorVisible(true);
      const t = setTimeout(() => setErrorVisible(false), 5000);
      return () => clearTimeout(t);
    } else {
      setErrorVisible(false);
    }
  }, [error]);

  // Close menu on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [showMenu]);

  async function handleDisconnect() {
    setShowMenu(false);
    await fetch("/api/wallet/logout", { method: "POST" });
    disconnect();
  }

  const truncate = (addr: string) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

  const displayName =
    localUser?.name ?? (localUser?.walletAddress ? truncate(localUser.walletAddress) : null);

  // On the server (and before hydration) render nothing — wagmi state is
  // client-only and renders differently, which causes hydration errors.
  if (!mounted) {
    return <div style={{ width: 110, height: 36 }} />;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", position: "relative" }}>
      {/* Wrong-network warning */}
      {wrongNetwork && (
        <button
          onClick={() => switchChain({ chainId: TARGET_CHAIN_ID })}
          style={{
            padding: "0.35rem 0.875rem",
            borderRadius: "8px",
            background: "rgba(255,77,77,0.15)",
            border: "1px solid rgba(255,77,77,0.4)",
            color: "#ff8080",
            fontSize: "0.8rem",
            fontWeight: 700,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Switch Network
        </button>
      )}

      {/* GZO balance */}
      {isConnected && !wrongNetwork && <GZOBalancePill />}

      {/* SIWE signing indicator */}
      {isSigning && (
        <div
          style={{
            padding: "0.35rem 0.875rem",
            borderRadius: "8px",
            background: "rgba(0,255,157,0.08)",
            border: "1px solid rgba(0,255,157,0.25)",
            color: "#00ff9d",
            fontSize: "0.8rem",
            fontWeight: 600,
            whiteSpace: "nowrap",
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        >
          Signing in…
        </div>
      )}

      {/* Error toast */}
      {errorVisible && error && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 0.5rem)",
            right: 0,
            background: "rgba(20,0,0,0.95)",
            border: "1px solid rgba(255,77,77,0.4)",
            borderRadius: "8px",
            padding: "0.5rem 0.875rem",
            color: "#ff8080",
            fontSize: "0.8rem",
            whiteSpace: "nowrap",
            zIndex: 1000,
            boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          }}
        >
          {error}
        </div>
      )}

      {/* Profile avatar/menu — shown when user is loaded */}
      {isConnected && !wrongNetwork && !isSigning && localUser && (
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            onClick={() => setShowMenu((v) => !v)}
            title={displayName ?? "Profile"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.45rem",
              background: "rgba(0,255,157,0.06)",
              border: "1px solid rgba(0,255,157,0.2)",
              borderRadius: "999px",
              padding: "0.3rem 0.75rem 0.3rem 0.4rem",
              cursor: "pointer",
              color: "#00ff9d",
              fontSize: "0.8rem",
              fontWeight: 600,
            }}
          >
            {/* Avatar circle */}
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "linear-gradient(135deg,#00ff9d,#00d4ff)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.7rem",
                fontWeight: 800,
                color: "#0a0a1a",
                flexShrink: 0,
              }}
            >
              {displayName ? displayName[0].toUpperCase() : "G"}
            </span>
            {displayName}
          </button>

          {showMenu && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 0.4rem)",
                right: 0,
                background: "#0d0d1f",
                border: "1px solid #2a2a50",
                borderRadius: "10px",
                minWidth: "160px",
                boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
                zIndex: 1000,
                overflow: "hidden",
              }}
            >
              <button
                onClick={() => { setShowMenu(false); setShowProfile(true); }}
                style={menuItemStyle}
              >
                Profile
              </button>
              <button
                onClick={handleDisconnect}
                style={{ ...menuItemStyle, color: "#ff8080" }}
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      )}

      {/* Show a placeholder while session/wagmi is restoring to prevent "Connect Wallet" flash */}
      {(sessionLoading || isReconnecting) ? (
        <div style={{
          width: 110, height: 36, borderRadius: 8,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid #2a2a50",
          animation: "pulse 1.5s ease-in-out infinite",
        }} />
      ) : (
        /* Only show ConnectButton when truly disconnected and no session */
        !user && (
          <ConnectButton
            accountStatus="avatar"
            chainStatus="none"
            showBalance={false}
            label="Connect Wallet"
          />
        )
      )}

      {/* Profile modal */}
      {showProfile && localUser && (
        <ProfileModal
          user={localUser}
          onClose={() => setShowProfile(false)}
          onUpdated={(updated) => {
            setLocalUser(updated);
            refetchUser();
            setShowProfile(false);
          }}
        />
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.65rem 1rem",
  background: "none",
  border: "none",
  color: "#e0e0ff",
  fontSize: "0.875rem",
  textAlign: "left",
  cursor: "pointer",
  transition: "background 0.15s",
};

function GZOBalancePill() {
  const { formatted, isLoading } = useGZOBalance();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.375rem",
        background: "rgba(0,255,157,0.08)",
        border: "1px solid rgba(0,255,157,0.22)",
        borderRadius: "999px",
        padding: "0.3rem 0.75rem",
        fontSize: "0.8125rem",
        fontWeight: 700,
        color: "#00ff9d",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#00ff9d",
          display: "inline-block",
          boxShadow: "0 0 6px #00ff9d",
        }}
      />
      {isLoading ? "…" : `${formatted} GZO`}
    </div>
  );
}
