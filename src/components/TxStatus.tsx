"use client";

import { txLink } from "@/lib/web3/contracts";

type Status = "idle" | "pending" | "confirming" | "success" | "error";

interface Props {
  status: Status;
  hash?: string;
  error?: Error | null;
  labels?: { pending?: string; confirming?: string; success?: string };
  compact?: boolean;
}

export default function TxStatus({ status, hash, error, labels, compact }: Props) {
  if (status === "idle") return null;

  const explorerUrl = hash ? txLink(hash) : null;

  const config: Record<Status, { color: string; bg: string; border: string; icon: string; text: string }> = {
    idle:       { color: "#8888aa", bg: "transparent",            border: "transparent",         icon: "",  text: "" },
    pending:    { color: "#ffd700", bg: "rgba(255,215,0,0.08)",   border: "rgba(255,215,0,0.2)", icon: "⏳", text: labels?.pending    ?? "Waiting for wallet…" },
    confirming: { color: "#00d4ff", bg: "rgba(0,212,255,0.08)",   border: "rgba(0,212,255,0.2)", icon: "🔄", text: labels?.confirming ?? "Confirming on chain…" },
    success:    { color: "#00ff9d", bg: "rgba(0,255,157,0.08)",   border: "rgba(0,255,157,0.2)", icon: "✓",  text: labels?.success    ?? "Transaction confirmed!" },
    error:      { color: "#ff8080", bg: "rgba(255,128,128,0.08)", border: "rgba(255,128,128,0.2)", icon: "✕", text: error?.message ?? "Transaction failed" },
  };

  const c = config[status];

  return (
    <div style={{
      display: "flex",
      alignItems: compact ? "center" : "flex-start",
      gap: "0.625rem",
      padding: compact ? "0.4rem 0.75rem" : "0.75rem 1rem",
      borderRadius: "10px",
      background: c.bg,
      border: `1px solid ${c.border}`,
      color: c.color,
      fontSize: compact ? "0.8rem" : "0.875rem",
      fontWeight: 600,
    }}>
      <span>{c.icon}</span>
      <span style={{ flex: 1 }}>{c.text}</span>
      {explorerUrl && status !== "error" && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: c.color, fontSize: "0.72rem", textDecoration: "none", whiteSpace: "nowrap", opacity: 0.8 }}
        >
          {hash?.slice(0, 10)}… ↗
        </a>
      )}
    </div>
  );
}

export function useTxStatus({
  isPending,
  isConfirming,
  isSuccess,
  error,
}: {
  isPending: boolean;
  isConfirming: boolean;
  isSuccess: boolean;
  error?: Error | null;
}): Status {
  if (error) return "error";
  if (isPending) return "pending";
  if (isConfirming) return "confirming";
  if (isSuccess) return "success";
  return "idle";
}
