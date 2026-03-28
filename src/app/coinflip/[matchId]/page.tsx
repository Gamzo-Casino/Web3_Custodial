"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { formatEther } from "viem";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import NetworkGuard from "@/components/NetworkGuard";
import ApproveGZO from "@/components/ApproveGZO";
import TxStatus, { useTxStatus } from "@/components/TxStatus";
import { useJoinMatch, useCancelMatch } from "@/lib/web3/hooks/useCoinFlip";
import { useVRFAutoFulfill } from "@/lib/web3/hooks/useVRFAutoFulfill";
import { ADDRESSES, COINFLIP_ABI } from "@/lib/web3/contracts";

// ── Status + outcome maps ───────────────────────────────────────────────────
const STATUS_LABEL: Record<number, string> = { 0: "PENDING", 1: "ACTIVE", 2: "SETTLED", 3: "CANCELLED" };
const OUTCOME_LABEL: Record<number, "HEADS" | "TAILS"> = { 0: "HEADS", 1: "TAILS" };

function statusColor(s: number) {
  if (s === 0) return { bg: "rgba(0,212,255,0.15)", color: "#00d4ff" };
  if (s === 2) return { bg: "rgba(0,255,157,0.15)", color: "#00ff9d" };
  return { bg: "rgba(255,128,128,0.15)", color: "#ff8080" };
}

function truncAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

interface MatchData {
  playerA: `0x${string}`;
  playerB: `0x${string}`;
  stake: bigint;
  playerAChoice: number;  // 0 = HEADS, 1 = TAILS
  outcome: number;        // 0 = HEADS, 1 = TAILS
  winner: `0x${string}`;
  status: number;         // 0-3
  vrfRequestId: bigint;
  createdAt: bigint;
  settledAt: bigint;
}

// ── Coin animation ──────────────────────────────────────────────────────────
function CoinDisplay({ outcome }: { outcome: "HEADS" | "TAILS" }) {
  const isHeads = outcome === "HEADS";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", padding: "2rem" }}>
      <div style={{
        width: 100, height: 100, borderRadius: "50%",
        background: isHeads
          ? "linear-gradient(135deg,#00ff9d,#00d4ff)"
          : "linear-gradient(135deg,#9b59ff,#ff69b4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "2.5rem", fontWeight: 900, color: "#0d0d1a",
        boxShadow: isHeads ? "0 0 40px rgba(0,255,157,0.5)" : "0 0 40px rgba(155,89,255,0.5)",
      }}>
        {isHeads ? "H" : "T"}
      </div>
      <div style={{ fontSize: "1.5rem", fontWeight: 900, color: isHeads ? "#00ff9d" : "#9b59ff", letterSpacing: "-0.5px" }}>
        {outcome}
      </div>
    </div>
  );
}

// ── Join Button ─────────────────────────────────────────────────────────────
function JoinSection({ roundId, stake, onJoined }: { roundId: `0x${string}`; stake: bigint; onJoined: () => void }) {
  const { joinMatch, hash, isPending, isConfirming, isSuccess, error } = useJoinMatch();
  const txStatus = useTxStatus({ isPending, isConfirming, isSuccess: false, error });

  useEffect(() => { if (isSuccess) { setTimeout(onJoined, 1000); } }, [isSuccess, onJoined]);

  return (
    <div className="card" style={{ background: "linear-gradient(135deg,#1a1a35,#12122a)", borderColor: "rgba(0,255,157,0.25)" }}>
      <div style={{ marginBottom: "1rem" }}>
        <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "0.25rem" }}>Join this match</div>
        <div style={{ color: "#8888aa", fontSize: "0.875rem" }}>
          You will play the opposite side for{" "}
          <strong style={{ color: "#00ff9d" }}>{Number(formatEther(stake)).toLocaleString()} GZO</strong>.
          Chainlink VRF will decide the outcome on-chain.
        </div>
      </div>
      {txStatus !== "idle" && (
        <div style={{ marginBottom: "0.75rem" }}>
          <TxStatus status={txStatus} hash={hash} error={error}
            labels={{ success: "Joined! Waiting for VRF…" }} />
        </div>
      )}
      <ApproveGZO spender={ADDRESSES.treasuryVault} requiredAmount={stake}>
        <button
          className="btn-primary"
          style={{ width: "100%", opacity: isPending || isConfirming ? 0.6 : 1 }}
          disabled={isPending || isConfirming}
          onClick={() => joinMatch(roundId)}
        >
          {isPending ? "Confirm in wallet…" : isConfirming ? "Joining…" : `Join for ${Number(formatEther(stake)).toLocaleString()} GZO`}
        </button>
      </ApproveGZO>
    </div>
  );
}

// ── Cancel Button ───────────────────────────────────────────────────────────
function CancelSection({ roundId, onCancelled }: { roundId: `0x${string}`; onCancelled: () => void }) {
  const { cancelMatch, hash, isPending, isConfirming, isSuccess, error } = useCancelMatch();
  const txStatus = useTxStatus({ isPending, isConfirming, isSuccess: false, error });

  useEffect(() => { if (isSuccess) { setTimeout(onCancelled, 1500); } }, [isSuccess, onCancelled]);

  return (
    <div style={{ marginTop: "1rem" }}>
      {txStatus !== "idle" && (
        <div style={{ marginBottom: "0.5rem" }}>
          <TxStatus status={txStatus} hash={hash} error={error}
            labels={{ success: "Match cancelled. Stake refunded." }} />
        </div>
      )}
      <button
        onClick={() => cancelMatch(roundId)}
        disabled={isPending || isConfirming}
        style={{
          background: "none", border: "1px solid rgba(255,80,80,0.3)", color: "#ff8080",
          borderRadius: "8px", padding: "0.5rem 1.25rem", fontSize: "0.875rem",
          cursor: isPending || isConfirming ? "not-allowed" : "pointer",
          opacity: isPending || isConfirming ? 0.6 : 1,
        }}
      >
        {isPending ? "Confirm cancel…" : isConfirming ? "Cancelling…" : "Cancel Match"}
      </button>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────
function MatchDetailInner() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const params = useParams();
  const router = useRouter();
  const roundId = params.matchId as `0x${string}`;

  const [match, setMatch] = useState<MatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const fetchMatch = useCallback(async () => {
    if (!publicClient || !roundId) return;
    try {
      const data = await publicClient.readContract({
        address: ADDRESSES.coinFlipGame,
        abi: COINFLIP_ABI,
        functionName: "getMatch",
        args: [roundId],
      }) as any;

      // playerA being zero address means match doesn't exist
      if (data.playerA === "0x0000000000000000000000000000000000000000") {
        setNotFound(true);
        return;
      }

      setMatch({
        playerA: data.playerA,
        playerB: data.playerB,
        stake: data.stake,
        playerAChoice: Number(data.playerAChoice),
        outcome: Number(data.outcome),
        winner: data.winner,
        status: Number(data.status),
        vrfRequestId: data.vrfRequestId,
        createdAt: data.createdAt,
        settledAt: data.settledAt,
      });
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [publicClient, roundId]);

  useEffect(() => {
    fetchMatch();
    const id = setInterval(() => {
      // Keep polling until settled or cancelled
      if (match && (match.status === 2 || match.status === 3)) return;
      fetchMatch();
    }, 3000);
    return () => clearInterval(id);
  }, [fetchMatch, match]);

  if (loading) {
    return <div style={{ color: "#8888aa", padding: "3rem" }}>Loading match…</div>;
  }

  if (notFound || !match) {
    return (
      <div style={{ padding: "3rem" }}>
        <div style={{ color: "#ff8080", marginBottom: "1rem" }}>Match not found.</div>
        <Link href="/coinflip" style={{ color: "#00ff9d", textDecoration: "none", fontSize: "0.875rem" }}>
          ← Back to Lobby
        </Link>
      </div>
    );
  }

  const addrLower = address?.toLowerCase() ?? "";
  const isPlayerA = addrLower === match.playerA.toLowerCase();
  const isPlayerB = addrLower === match.playerB.toLowerCase();
  const isPending = match.status === 0;
  const isActive = match.status === 1;

  // Auto-fulfill VRF when match is ACTIVE (joined, waiting for randomness)
  useVRFAutoFulfill(isActive);
  const isSettled = match.status === 2;
  const isCancelled = match.status === 3;

  const canJoin = isPending && !isPlayerA && !!address;
  const canCancel = isPending && isPlayerA;

  const ZERO = "0x0000000000000000000000000000000000000000";
  const hasPlayerB = match.playerB !== ZERO;
  const outcomeLabel = isSettled ? OUTCOME_LABEL[match.outcome] : null;
  const didWin = isSettled && match.winner.toLowerCase() === addrLower;

  const sc = statusColor(match.status);

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <Link href="/coinflip" style={{ fontSize: "0.875rem", color: "#8888aa", textDecoration: "none" }}>
          ← Back to Lobby
        </Link>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.5px", marginTop: "0.75rem" }}>
          Match {roundId.slice(0, 10)}…
        </h1>
      </div>

      {/* Status badge */}
      <div style={{ marginBottom: "1.5rem" }}>
        <span style={{
          display: "inline-block", padding: "0.25rem 0.75rem", borderRadius: "99px",
          fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const,
          background: sc.bg, color: sc.color,
        }}>
          {STATUS_LABEL[match.status]}
        </span>
        {isActive && (
          <span style={{ marginLeft: "0.75rem", fontSize: "0.8rem", color: "#00d4ff" }}>
            ⏳ Waiting for Chainlink VRF…
          </span>
        )}
      </div>

      {/* Outcome (settled) */}
      {isSettled && outcomeLabel && (
        <div className="card" style={{
          marginBottom: "1.5rem", textAlign: "center",
          background: "linear-gradient(135deg,#1a1a35,#12122a)",
          borderColor: outcomeLabel === "HEADS" ? "rgba(0,255,157,0.3)" : "rgba(155,89,255,0.3)",
        }}>
          <CoinDisplay outcome={outcomeLabel} />
          {(isPlayerA || isPlayerB) && (
            <div style={{ fontSize: "1.125rem", fontWeight: 800, color: didWin ? "#00ff9d" : "#ff8080", marginBottom: "0.5rem" }}>
              {didWin ? "You Won!" : "You Lost"}
            </div>
          )}
          <div style={{ color: "#8888aa", fontSize: "0.875rem" }}>
            Pot: <span style={{ color: "#f0f0ff", fontWeight: 700 }}>
              {Number(formatEther(match.stake * 2n)).toLocaleString()}
            </span> GZO
          </div>
          {match.winner !== ZERO && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "#8888aa" }}>
              Winner: <span style={{ fontFamily: "monospace", color: "#f0f0ff" }}>{truncAddr(match.winner)}</span>
            </div>
          )}
        </div>
      )}

      {/* Match details */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div>
            <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#8888aa", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: "0.25rem" }}>Stake</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "#00ff9d" }}>
              {Number(formatEther(match.stake)).toLocaleString()} GZO
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#8888aa", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: "0.25rem" }}>Player A side</div>
            <div style={{ fontSize: "1rem", fontWeight: 800, color: match.playerAChoice === 0 ? "#00ff9d" : "#9b59ff" }}>
              {match.playerAChoice === 0 ? "HEADS" : "TAILS"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#8888aa", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: "0.25rem" }}>Player A</div>
            <div style={{ fontFamily: "monospace", fontWeight: 600, color: isPlayerA ? "#00ff9d" : "#f0f0ff", fontSize: "0.875rem" }}>
              {truncAddr(match.playerA)}
              {isPlayerA && <span style={{ marginLeft: "0.4rem", fontSize: "0.65rem", background: "rgba(0,255,157,0.1)", color: "#00ff9d", padding: "0.1rem 0.4rem", borderRadius: "4px" }}>You</span>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#8888aa", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: "0.25rem" }}>Player B</div>
            <div style={{ fontFamily: "monospace", fontWeight: 600, color: isPlayerB ? "#00ff9d" : hasPlayerB ? "#f0f0ff" : "#555577", fontSize: "0.875rem" }}>
              {hasPlayerB ? (
                <>
                  {truncAddr(match.playerB)}
                  {isPlayerB && <span style={{ marginLeft: "0.4rem", fontSize: "0.65rem", background: "rgba(0,255,157,0.1)", color: "#00ff9d", padding: "0.1rem 0.4rem", borderRadius: "4px" }}>You</span>}
                </>
              ) : "Waiting for opponent…"}
            </div>
          </div>
          {match.vrfRequestId > 0n && (
            <div style={{ gridColumn: "span 2" }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#8888aa", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: "0.25rem" }}>VRF Request ID</div>
              <div style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#8888aa" }}>#{match.vrfRequestId.toString()}</div>
            </div>
          )}
        </div>
      </div>

      {/* Join CTA */}
      {canJoin && (
        <JoinSection roundId={roundId} stake={match.stake} onJoined={fetchMatch} />
      )}

      {/* Connect prompt */}
      {isPending && !address && (
        <div className="card" style={{ textAlign: "center" }}>
          <p style={{ color: "#8888aa", marginBottom: "1rem" }}>Connect your wallet to join this match.</p>
        </div>
      )}

      {/* Cancel (creator only, pending) */}
      {canCancel && (
        <CancelSection roundId={roundId} onCancelled={() => router.push("/coinflip")} />
      )}

      {/* Cancelled notice */}
      {isCancelled && (
        <div className="card" style={{ textAlign: "center", color: "#8888aa" }}>
          This match was cancelled. Stake has been refunded.
          <div style={{ marginTop: "1rem" }}>
            <Link href="/coinflip" className="btn-primary">Back to Lobby</Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MatchDetailPage() {
  return (
    <NetworkGuard>
      <MatchDetailInner />
    </NetworkGuard>
  );
}
