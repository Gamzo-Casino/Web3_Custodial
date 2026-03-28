"use client";

import { useApproveGZO } from "@/lib/web3/hooks/useApproval";
import { useGZOAllowance } from "@/lib/web3/hooks/useGZOBalance";
import TxStatus, { useTxStatus } from "./TxStatus";
import { formatEther } from "viem";

interface Props {
  spender: `0x${string}`;
  requiredAmount: bigint;
  /** Called after approval is confirmed */
  onApproved?: () => void;
  children: React.ReactNode;
}

/**
 * Wraps a game action: if allowance is insufficient, shows an "Approve GZO" button.
 * Once approved, renders children.
 */
export default function ApproveGZO({ spender, requiredAmount, onApproved, children }: Props) {
  const { raw: allowance } = useGZOAllowance(spender);
  const { approve, hash, isPending, isConfirming, isSuccess, error } = useApproveGZO(spender);
  const txStatus = useTxStatus({ isPending, isConfirming, isSuccess: isSuccess && allowance < requiredAmount, error });

  if (allowance >= requiredAmount) {
    return <>{children}</>;
  }

  const requiredDisplay = Number(formatEther(requiredAmount)).toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{
        padding: "0.875rem 1.125rem",
        background: "rgba(255,157,0,0.06)",
        border: "1px solid rgba(255,157,0,0.2)",
        borderRadius: "12px",
        fontSize: "0.875rem",
        color: "#ff9d00",
      }}>
        <strong>Approval needed</strong> — You need to approve at least{" "}
        <strong>{requiredDisplay} GZO</strong> before placing this bet.
      </div>

      {txStatus !== "idle" && (
        <TxStatus
          status={txStatus}
          hash={hash}
          error={error}
          labels={{ success: "GZO approved! You can now place your bet." }}
        />
      )}

      <button
        onClick={() => approve()}
        disabled={isPending || isConfirming}
        className="btn-primary"
        style={{ opacity: isPending || isConfirming ? 0.6 : 1 }}
      >
        {isPending ? "Confirm in wallet…" : isConfirming ? "Approving…" : "Approve GZO"}
      </button>
    </div>
  );
}
