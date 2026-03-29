"use client";

import { useDBBalance } from "@/lib/web3/hooks/useDBBalance";
import { useWalletUser } from "@/contexts/WalletAuthContext";

export default function GZOBalanceCard() {
  const { formatted, isLoading } = useDBBalance();
  const { user } = useWalletUser();

  return (
    <div
      className="card"
      style={{
        marginBottom: "2rem",
        background: "linear-gradient(135deg, #0f1f17 0%, #0d0d1f 100%)",
        border: "1px solid rgba(0,255,157,0.25)",
        boxShadow: "0 0 30px rgba(0,255,157,0.08)",
        padding: "1.5rem 1.75rem",
      }}
    >
      <div className="balance-card-inner">
        <div>
          <div
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              color: "#8888aa",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: "0.625rem",
            }}
          >
            GZO Balance
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.625rem" }}>
            <div
              style={{
                fontSize: "clamp(2rem, 5vw, 3rem)",
                fontWeight: 900,
                letterSpacing: "-1.5px",
                color: "#00ff9d",
                textShadow: "0 0 24px rgba(0,255,157,0.45)",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {isLoading ? "…" : formatted}
            </div>
            <div style={{ fontSize: "1rem", fontWeight: 600, color: "rgba(0,255,157,0.6)" }}>
              GZO
            </div>
          </div>
          {user?.walletAddress && (
            <div
              style={{
                fontSize: "0.75rem",
                color: "#555577",
                marginTop: "0.375rem",
                fontFamily: "monospace",
                wordBreak: "break-all",
              }}
            >
              {user.walletAddress.slice(0, 8)}…{user.walletAddress.slice(-6)}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
          <div
            style={{
              fontSize: "0.8rem",
              color: "#555577",
              textAlign: "right",
            }}
          >
            Provably fair · 10% fee on profit only
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                background: "rgba(0,255,157,0.08)",
                border: "1px solid rgba(0,255,157,0.2)",
                borderRadius: "999px",
                padding: "0.25rem 0.75rem",
                fontSize: "0.75rem",
                color: "#00ff9d",
                fontWeight: 600,
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
              Custodial
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
