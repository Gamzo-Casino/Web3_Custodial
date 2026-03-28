"use client";

import { useEffect, useState, useCallback } from "react";
import { EXPLORER_URL } from "@/lib/web3/contracts";

interface TxRow {
  id: string;
  type: "DEPOSIT" | "WITHDRAWAL";
  txHash: string | null;
  amountGzo: number;
  status: string;
  createdAt: string;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  CONFIRMED:  { label: "Confirmed",   color: "#00ff9d" },
  COMPLETED:  { label: "Completed",   color: "#00ff9d" },
  PENDING:    { label: "Pending",     color: "#ffcc00" },
  PROCESSING: { label: "Processing",  color: "#ffcc00" },
  APPROVED:   { label: "Approved",    color: "#00ff9d" },
  FAILED:     { label: "Failed",      color: "#ff6060" },
  REJECTED:   { label: "Rejected",    color: "#ff6060" },
};

function explorerTxUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function WalletTransactions() {
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet/transactions");
      if (res.ok) {
        const data = await res.json();
        setTxs(data.transactions ?? []);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div style={{ marginTop: "2.5rem", marginBottom: "3rem" }}>
      {/* Section header */}
      <div
        style={{
          fontSize: "0.7rem",
          fontWeight: 700,
          color: "#8888aa",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginBottom: "1rem",
        }}
      >
        Transaction History
      </div>

      <div
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "1rem",
          overflow: "hidden",
        }}
      >
        {/* Table header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "90px 1fr 140px 110px 110px",
            padding: "0.6rem 1.25rem",
            background: "rgba(255,255,255,0.03)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            fontSize: "0.68rem",
            fontWeight: 700,
            color: "#666688",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <span>Type</span>
          <span>Tx Hash</span>
          <span style={{ textAlign: "right" }}>Amount</span>
          <span style={{ textAlign: "center" }}>Status</span>
          <span style={{ textAlign: "right" }}>Date</span>
        </div>

        {/* Rows */}
        {isLoading ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "#555577", fontSize: "0.85rem" }}>
            Loading…
          </div>
        ) : txs.length === 0 ? (
          <div style={{ padding: "2.5rem", textAlign: "center", color: "#555577", fontSize: "0.85rem" }}>
            No transactions yet. Deposit GZO to get started.
          </div>
        ) : (
          txs.map((tx, i) => {
            const isDeposit = tx.type === "DEPOSIT";
            const typeColor = isDeposit ? "#00ff9d" : "#ff9d00";
            const statusMeta = STATUS_META[tx.status] ?? { label: tx.status, color: "#8888aa" };

            return (
              <div
                key={tx.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "90px 1fr 140px 110px 110px",
                  padding: "0.75rem 1.25rem",
                  borderBottom:
                    i < txs.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  alignItems: "center",
                  fontSize: "0.82rem",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.background = "transparent")
                }
              >
                {/* Type badge */}
                <span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.3rem",
                      background: `${typeColor}14`,
                      border: `1px solid ${typeColor}33`,
                      borderRadius: "999px",
                      padding: "0.2rem 0.55rem",
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      color: typeColor,
                    }}
                  >
                    {isDeposit ? "▼ Deposit" : "▲ Withdraw"}
                  </span>
                </span>

                {/* Tx Hash */}
                <span style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>
                  {tx.txHash ? (
                    <a
                      href={explorerTxUrl(tx.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "#7777ff",
                        textDecoration: "none",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.3rem",
                      }}
                      onMouseEnter={(e) =>
                        ((e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline")
                      }
                      onMouseLeave={(e) =>
                        ((e.currentTarget as HTMLAnchorElement).style.textDecoration = "none")
                      }
                    >
                      {shortHash(tx.txHash)}
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 12 12"
                        fill="none"
                        style={{ opacity: 0.6, flexShrink: 0 }}
                      >
                        <path
                          d="M2 10L10 2M10 2H5M10 2V7"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </a>
                  ) : (
                    <span style={{ color: "#444466" }}>—</span>
                  )}
                </span>

                {/* Amount */}
                <span
                  style={{
                    textAlign: "right",
                    fontWeight: 700,
                    color: isDeposit ? "#00ff9d" : "#ff9d00",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {isDeposit ? "+" : "−"}
                  {tx.amountGzo.toLocaleString(undefined, { maximumFractionDigits: 2 })} GZO
                </span>

                {/* Status */}
                <span style={{ textAlign: "center" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.25rem",
                      fontSize: "0.72rem",
                      fontWeight: 600,
                      color: statusMeta.color,
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: statusMeta.color,
                        display: "inline-block",
                        boxShadow: `0 0 5px ${statusMeta.color}`,
                        flexShrink: 0,
                      }}
                    />
                    {statusMeta.label}
                  </span>
                </span>

                {/* Date */}
                <span
                  style={{
                    textAlign: "right",
                    color: "#555577",
                    fontSize: "0.75rem",
                  }}
                >
                  {formatDate(tx.createdAt)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
