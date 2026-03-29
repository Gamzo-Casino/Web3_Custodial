"use client";

import { useState, useCallback, useEffect } from "react";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
  useConnect,
} from "wagmi";
import { parseEther } from "viem";
import { GZO_ABI, ADDRESSES } from "@/lib/web3/contracts";
import { useDBBalance } from "@/lib/web3/hooks/useDBBalance";

// ── tiny shared styles ────────────────────────────────────────────────────────

function cardStyle(accentRgb: string, bgStart: string): React.CSSProperties {
  return {
    background: `linear-gradient(135deg, ${bgStart} 0%, #0d0d1f 100%)`,
    border: `1px solid rgba(${accentRgb},0.25)`,
    borderRadius: "1rem",
    padding: "1.75rem 2rem",
    flex: 1,
    minWidth: 260,
    boxShadow: `0 0 30px rgba(${accentRgb},0.08)`,
  };
}

function labelStyle(color: string): React.CSSProperties {
  return {
    fontSize: "0.7rem",
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    marginBottom: "0.75rem",
    color,
  };
}

function inputStyle(accentRgb: string): React.CSSProperties {
  return {
    width: "100%",
    background: "rgba(255,255,255,0.04)",
    border: `1px solid rgba(${accentRgb},0.18)`,
    borderRadius: "0.5rem",
    padding: "0.625rem 0.875rem",
    color: "#f0f0ff",
    fontSize: "1rem",
    outline: "none",
    boxSizing: "border-box",
  };
}

function Btn({
  onClick,
  disabled,
  loading,
  color = "#00ff9d",
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  color?: string;
  children: React.ReactNode;
}) {
  const isDisabled = disabled || loading;
  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      style={{
        marginTop: "1rem",
        width: "100%",
        padding: "0.75rem",
        borderRadius: "0.5rem",
        background: isDisabled ? "rgba(255,255,255,0.04)" : `${color}18`,
        border: `1px solid ${isDisabled ? "rgba(255,255,255,0.08)" : color + "44"}`,
        color: isDisabled ? "#445566" : color,
        fontWeight: 700,
        fontSize: "0.88rem",
        cursor: isDisabled ? "not-allowed" : "pointer",
        transition: "all 0.15s",
        boxShadow: isDisabled ? "none" : `0 0 12px ${color}18`,
        letterSpacing: "0.03em",
      }}
    >
      {loading ? "Processing…" : children}
    </button>
  );
}

function StatusMsg({ text, type }: { text: string; type: "success" | "error" | "info" }) {
  const colors = {
    success: { bg: "rgba(0,255,157,0.08)", border: "rgba(0,255,157,0.25)", text: "#00ff9d" },
    error: { bg: "rgba(255,80,80,0.08)", border: "rgba(255,80,80,0.25)", text: "#ff8080" },
    info: { bg: "rgba(120,120,255,0.08)", border: "rgba(120,120,255,0.25)", text: "#aaaaff" },
  }[type];
  return (
    <div
      style={{
        marginTop: "0.75rem",
        padding: "0.5rem 0.75rem",
        borderRadius: "0.5rem",
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        color: colors.text,
        fontSize: "0.78rem",
        lineHeight: 1.5,
        wordBreak: "break-all",
      }}
    >
      {text}
    </div>
  );
}

// ── Deposit Panel ─────────────────────────────────────────────────────────────

function DepositSection({ onSuccess }: { onSuccess: () => void }) {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmedHash, setConfirmedHash] = useState<string | undefined>(undefined);

  const houseAddress = process.env.NEXT_PUBLIC_HOUSE_DEPOSIT_ADDRESS as `0x${string}` | undefined;

  const { writeContract, data: txHash, isPending: isSending, reset } = useWriteContract();

  const { isLoading: isWaiting, isSuccess: txConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // After on-chain confirmation, call the confirm API (only once per hash)
  const handleConfirmDeposit = useCallback(
    async (hash: string) => {
      setConfirming(true);
      setStatus({ text: "Verifying on-chain transfer…", type: "info" });
      try {
        const res = await fetch("/api/wallet/deposit/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash: hash }),
        });
        const data = await res.json();
        if (!res.ok) {
          setStatus({ text: data.error ?? "Confirmation failed", type: "error" });
        } else {
          setStatus({
            text: `Deposit confirmed! +${data.amountGzo} GZO added to your balance.`,
            type: "success",
          });
          setAmount("");
          reset();
          onSuccess();
        }
      } catch {
        setStatus({ text: "Network error during confirmation. Please contact support.", type: "error" });
      } finally {
        setConfirming(false);
      }
    },
    [onSuccess, reset]
  );

  // When wagmi confirms the tx, call the backend (useEffect avoids calling in render)
  useEffect(() => {
    if (txConfirmed && txHash && txHash !== confirmedHash) {
      setConfirmedHash(txHash);
      handleConfirmDeposit(txHash);
    }
  }, [txConfirmed, txHash, confirmedHash, handleConfirmDeposit]);

  const handleDeposit = () => {
    if (!houseAddress || houseAddress === "0x0000000000000000000000000000000000000001") {
      setStatus({ text: "Deposits are not configured yet. Contact the operator.", type: "error" });
      return;
    }
    const parsed = parseFloat(amount);
    if (!parsed || parsed < 1) {
      setStatus({ text: "Minimum deposit is 1 GZO", type: "error" });
      return;
    }
    setStatus({ text: "Waiting for wallet signature…", type: "info" });
    writeContract({
      address: ADDRESSES.gzoToken,
      abi: GZO_ABI,
      functionName: "transfer",
      args: [houseAddress, parseEther(String(parsed))],
    });
  };

  const isLoading = isSending || isWaiting || confirming;

  const GREEN = "0,255,157";

  return (
    <div style={cardStyle(GREEN, "#0f1f17")}>
      <div style={labelStyle("#00ff9d")}>Deposit GZO</div>
      <p style={{ fontSize: "0.78rem", color: "#556677", marginBottom: "1.25rem", lineHeight: 1.6 }}>
        Send GZO from your wallet to fund your casino balance. After on-chain confirmation
        your balance updates instantly.
      </p>

      {!isConnected ? (
        <div>
          <p style={{ fontSize: "0.8rem", color: "#8888aa", marginBottom: "0.75rem" }}>
            Connect a wallet to deposit.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {connectors.map((c) => (
              <Btn key={c.uid} onClick={() => connect({ connector: c })}>
                Connect {c.name}
              </Btn>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: "0.35rem", fontSize: "0.72rem", color: "#8888aa", letterSpacing: "0.05em" }}>
            Amount (GZO)
          </div>
          <input
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="100"
            style={inputStyle(GREEN)}
            disabled={isLoading}
          />
          {houseAddress && houseAddress !== "0x0000000000000000000000000000000000000001" && (
            <div style={{ fontSize: "0.68rem", color: "#334455", marginTop: "0.4rem", fontFamily: "monospace" }}>
              To: {houseAddress.slice(0, 10)}…{houseAddress.slice(-8)}
            </div>
          )}
          <Btn onClick={handleDeposit} loading={isLoading} disabled={isLoading || !amount}>
            Deposit GZO →
          </Btn>
          {status && <StatusMsg text={status.text} type={status.type} />}
        </>
      )}
    </div>
  );
}

// ── Withdraw Panel ────────────────────────────────────────────────────────────

function WithdrawSection({ maxBalance, onSuccess }: { maxBalance: number; onSuccess: () => void }) {
  const { isConnected } = useAccount();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  const handleWithdraw = async () => {
    const parsed = parseFloat(amount);
    if (!parsed || parsed < 1) {
      setStatus({ text: "Minimum withdrawal is 1 GZO", type: "error" });
      return;
    }
    if (parsed > maxBalance) {
      setStatus({ text: `Exceeds your balance of ${maxBalance.toLocaleString()} GZO`, type: "error" });
      return;
    }

    setLoading(true);
    setStatus({ text: "Processing withdrawal…", type: "info" });

    try {
      const res = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountGzo: parsed }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus({ text: data.error ?? "Withdrawal failed", type: "error" });
      } else {
        setStatus({
          text: `Withdrawal sent! ${parsed} GZO on its way. Tx: ${data.txHash?.slice(0, 18)}…`,
          type: "success",
        });
        setAmount("");
        onSuccess();
      }
    } catch {
      setStatus({ text: "Network error. Please try again.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const AMBER = "255,157,0";

  if (!isConnected) {
    return (
      <div style={cardStyle(AMBER, "#1f1600")}>
        <div style={labelStyle("#ff9d00")}>Withdraw GZO</div>
        <p style={{ fontSize: "0.8rem", color: "#8888aa" }}>
          Connect your wallet to withdraw.
        </p>
      </div>
    );
  }

  return (
    <div style={cardStyle(AMBER, "#1f1600")}>
      <div style={labelStyle("#ff9d00")}>Withdraw GZO</div>
      <p style={{ fontSize: "0.78rem", color: "#556677", marginBottom: "1.25rem", lineHeight: 1.6 }}>
        Withdraw GZO to your connected wallet. Your balance will be debited immediately
        and the on-chain transfer sent by the house.
      </p>

      <div style={{ marginBottom: "0.35rem", fontSize: "0.72rem", color: "#8888aa", letterSpacing: "0.05em" }}>
        Amount (GZO) — max {maxBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input
          type="number"
          min="1"
          step="1"
          max={maxBalance}
          value={amount}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (v > maxBalance) setAmount(String(maxBalance));
            else setAmount(e.target.value);
          }}
          placeholder={maxBalance > 0 ? String(Math.floor(maxBalance)) : "0"}
          style={inputStyle(AMBER)}
          disabled={loading || maxBalance <= 0}
        />
        <button
          onClick={() => setAmount(String(Math.floor(maxBalance)))}
          disabled={loading || maxBalance <= 0}
          style={{
            padding: "0.625rem 0.875rem",
            borderRadius: "0.5rem",
            background: "rgba(255,157,0,0.1)",
            border: "1px solid rgba(255,157,0,0.35)",
            color: "#ff9d00",
            fontSize: "0.78rem",
            fontWeight: 700,
            cursor: maxBalance > 0 ? "pointer" : "not-allowed",
            whiteSpace: "nowrap",
            boxShadow: "0 0 8px rgba(255,157,0,0.12)",
          }}
        >
          Max
        </button>
      </div>

      <Btn
        onClick={handleWithdraw}
        loading={loading}
        disabled={loading || !amount || maxBalance <= 0}
        color="#ff9d00"
      >
        Withdraw GZO →
      </Btn>

      {maxBalance <= 0 && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#445566" }}>
          No balance available to withdraw. Deposit first.
        </div>
      )}

      {status && <StatusMsg text={status.text} type={status.type} />}
    </div>
  );
}

// ── Combined Panel ────────────────────────────────────────────────────────────

export default function DepositWithdrawPanel() {
  const { balance, refetch } = useDBBalance();

  return (
    <div style={{ marginBottom: "2rem" }}>
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
        Funds
      </div>
      <div className="deposit-withdraw-row">
        <DepositSection onSuccess={refetch} />
        <WithdrawSection maxBalance={balance} onSuccess={refetch} />
      </div>
    </div>
  );
}
