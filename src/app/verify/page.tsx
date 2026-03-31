"use client";

import { useState, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";

// ── Types ──────────────────────────────────────────────────────────────────────
type TxEvent = {
  game: string;
  event: string;
  logIndex: number;
  address: string;
  fields: Record<string, string>;
};

type VrfData = {
  vrfRequestId:  string;
  randomWord:    string | null;
  fulfilled:     boolean;
  randomWordHex: string | null;
  derivedInfo:   string | null;
};

type TxResult = {
  txHash: string;
  status: string;
  block: string;
  gasUsed: string;
  from: string;
  to: string | null;
  game: string;
  outcome: string;
  netPayout: string;
  events: TxEvent[];
  transfers: { from: string; to: string; amount: string }[];
  vrfData:   VrfData | null;
  roundData: Record<string, string> | null;
  explorerUrl: string;
};

// ── Shared sub-components ──────────────────────────────────────────────────────
function DataRow({ label, value, mono = true, accent }: { label: string; value: string; mono?: boolean; accent?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      gap: "1rem", padding: "0.5rem 0", borderBottom: "1px solid #1a1a35",
    }}>
      <span style={{ fontSize: "0.78rem", color: "#8888aa", flexShrink: 0, minWidth: "120px" }}>{label}</span>
      <span style={{
        fontSize: "0.78rem", color: accent ?? "#f0f0ff",
        fontFamily: mono ? "monospace" : "inherit",
        wordBreak: "break-all", textAlign: "right",
      }}>{value}</span>
    </div>
  );
}

// ── TX Hash Lookup ─────────────────────────────────────────────────────────────
function TxVerifyTab() {
  const [hash,    setHash]    = useState("");
  const [result,  setResult]  = useState<TxResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const lookup = useCallback((h: string) => {
    const clean = h.trim();
    if (!clean) return;
    if (!/^0x[0-9a-fA-F]{64}$/.test(clean)) {
      setError("Enter a valid 0x transaction hash (66 chars)");
      return;
    }
    setError("");
    setResult(null);
    setLoading(true);
    fetch(`/api/verify/tx?hash=${clean}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setResult(d as TxResult);
      })
      .catch(() => setError("Network error — please try again"))
      .finally(() => setLoading(false));
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    lookup(hash);
  }

  const outcomeColor = (o: string) => {
    if (o.includes("WIN") || o === "Won")   return "#00ff9d";
    if (o === "Lost" || o.includes("LOSS")) return "#ff8080";
    if (o === "Success")                    return "#00ff9d";
    if (o === "Failed")                     return "#ff8080";
    return "#ffd700";
  };

  return (
    <div>
      {/* Input */}
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <input
          type="text"
          value={hash}
          onChange={e => setHash(e.target.value)}
          placeholder="0x… paste your transaction hash here"
          style={{
            flex: 1, minWidth: "280px", background: "#0d0d1a", border: "1px solid #2a2a50",
            borderRadius: "10px", padding: "0.7rem 1rem", color: "#f0f0ff",
            fontSize: "0.875rem", fontFamily: "monospace", outline: "none",
          }}
        />
        <button type="submit" className="btn-primary" style={{ flexShrink: 0, minWidth: "120px" }}
          disabled={loading}>
          {loading ? "Looking up…" : "Look Up"}
        </button>
      </form>

      {error && (
        <div style={{
          padding: "0.75rem 1rem", borderRadius: "10px", marginBottom: "1.25rem",
          background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.3)", color: "#ff8080", fontSize: "0.875rem",
        }}>{error}</div>
      )}

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", color: "#8888aa", padding: "3rem 0", justifyContent: "center" }}>
          <div style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid #00ff9d44", borderTopColor: "#00ff9d", animation: "spin 0.8s linear infinite" }} />
          Fetching from Polygon Amoy…
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

          {/* Summary card */}
          <div className="card" style={{
            background: result.status === "Success" ? "rgba(0,255,157,0.05)" : "rgba(255,80,80,0.05)",
            borderColor: result.status === "Success" ? "rgba(0,255,157,0.25)" : "rgba(255,80,80,0.25)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
              <div>
                <div style={{ fontSize: "0.65rem", color: "#555577", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.25rem" }}>
                  {result.game} · Polygon Amoy
                </div>
                <div style={{ fontSize: "1.5rem", fontWeight: 900, color: outcomeColor(result.outcome) }}>
                  {result.outcome}
                </div>
                {result.netPayout !== "—" && (
                  <div style={{ fontSize: "0.85rem", color: "#00ff9d", fontWeight: 700, marginTop: "0.2rem" }}>
                    Payout: {result.netPayout}
                  </div>
                )}
              </div>
              <a href={result.explorerUrl} target="_blank" rel="noopener noreferrer" style={{
                padding: "0.45rem 1rem", borderRadius: "8px", fontSize: "0.8rem", fontWeight: 600,
                color: "#00d4ff", border: "1px solid #00d4ff44", background: "#00d4ff0d",
                textDecoration: "none",
              }}>
                View on Explorer ↗
              </a>
            </div>

            <DataRow label="Tx Hash"  value={result.txHash} />
            <DataRow label="Status"   value={result.status}  mono={false} accent={result.status === "Success" ? "#00ff9d" : "#ff8080"} />
            <DataRow label="Block"    value={`#${result.block}`} />
            <DataRow label="Gas Used" value={Number(result.gasUsed).toLocaleString()} mono={false} />
            <DataRow label="From"     value={result.from} />
            <DataRow label="To"       value={result.to ?? "—"} />
          </div>

          {/* GZO Transfers */}
          {result.transfers.length > 0 && (
            <div className="card">
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#00ff9d", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.75rem" }}>
                GZO Token Transfers
              </div>
              {result.transfers.map((t, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: "0.5rem",
                  padding: "0.5rem 0", borderBottom: i < result.transfers.length - 1 ? "1px solid #1a1a35" : "none",
                  flexWrap: "wrap",
                }}>
                  <span style={{ fontSize: "0.78rem", fontFamily: "monospace", color: "#8888aa" }}>
                    {t.from.slice(0, 6)}…{t.from.slice(-4)}
                  </span>
                  <span style={{ color: "#555577", fontSize: "0.8rem" }}>→</span>
                  <span style={{ fontSize: "0.78rem", fontFamily: "monospace", color: "#8888aa" }}>
                    {t.to.slice(0, 6)}…{t.to.slice(-4)}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: "0.82rem", fontWeight: 700, color: "#00ff9d" }}>
                    {t.amount}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Contract Events */}
          {result.events.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#555577", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Contract Events ({result.events.length})
              </div>
              {result.events.map((ev, i) => (
                <div key={i} className="card" style={{ padding: "1rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                    <span style={{
                      padding: "0.2rem 0.6rem", borderRadius: "99px", fontSize: "0.7rem", fontWeight: 700,
                      background: "rgba(0,212,255,0.12)", color: "#00d4ff", border: "1px solid rgba(0,212,255,0.25)",
                    }}>
                      {ev.game}
                    </span>
                    <span style={{
                      padding: "0.2rem 0.6rem", borderRadius: "99px", fontSize: "0.7rem", fontWeight: 700,
                      background: "rgba(168,85,247,0.12)", color: "#a855f7", border: "1px solid rgba(168,85,247,0.25)",
                    }}>
                      {ev.event}
                    </span>
                    <span style={{ fontSize: "0.65rem", color: "#555577", marginLeft: "auto" }}>
                      Log #{ev.logIndex}
                    </span>
                  </div>
                  {Object.entries(ev.fields).map(([k, v]) => (
                    <DataRow key={k} label={k} value={v}
                      accent={
                        v.includes("WIN") ? "#00ff9d" :
                        v === "✗ LOSS"    ? "#ff8080" :
                        k === "Net Payout" ? "#00ff9d" :
                        k === "Multiplier" ? "#ffd700" : undefined
                      }
                    />
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Chainlink VRF */}
          {result.vrfData && (
            <div className="card" style={{
              background: result.vrfData.fulfilled ? "rgba(168,85,247,0.05)" : "rgba(255,180,0,0.05)",
              borderColor: result.vrfData.fulfilled ? "rgba(168,85,247,0.3)" : "rgba(255,180,0,0.3)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <span style={{
                  padding: "0.2rem 0.6rem", borderRadius: "99px", fontSize: "0.7rem", fontWeight: 700,
                  background: "rgba(168,85,247,0.12)", color: "#a855f7", border: "1px solid rgba(168,85,247,0.25)",
                }}>
                  Chainlink VRF
                </span>
                <span style={{ fontSize: "0.7rem", color: result.vrfData.fulfilled ? "#00ff9d" : "#ffd700" }}>
                  {result.vrfData.fulfilled ? "✓ Fulfilled" : "⏳ Pending"}
                </span>
              </div>
              <DataRow label="VRF Request ID" value={result.vrfData.vrfRequestId} />
              {result.vrfData.randomWordHex && (
                <DataRow label="Random Word (hex)" value={result.vrfData.randomWordHex} />
              )}
              {result.vrfData.randomWord && (
                <DataRow label="Random Word (dec)" value={BigInt(result.vrfData.randomWord).toLocaleString()} />
              )}
              {result.vrfData.derivedInfo && (
                <DataRow label="Derived Result" value={result.vrfData.derivedInfo} accent="#ffd700" />
              )}
              {!result.vrfData.fulfilled && (
                <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#8888aa" }}>
                  VRF randomness has not been fulfilled yet — check back after Chainlink responds.
                </div>
              )}
            </div>
          )}

          {/* Round State (On-Chain) */}
          {result.roundData && Object.keys(result.roundData).length > 0 && (
            <div className="card" style={{ background: "rgba(0,212,255,0.04)", borderColor: "rgba(0,212,255,0.2)" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#00d4ff", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.75rem" }}>
                Round State (On-Chain)
              </div>
              {Object.entries(result.roundData).map(([k, v]) => (
                <DataRow key={k} label={k} value={v}
                  accent={
                    k === "Won" && v === "true"               ? "#00ff9d" :
                    k === "Won" && v === "false"              ? "#ff8080" :
                    k === "Status" && v.includes("Settled")   ? "#00ff9d" :
                    k === "Status" && v.includes("Lost")      ? "#ff8080" :
                    k === "Net Payout"                        ? "#00ff9d" :
                    k === "Multiplier"                        ? "#ffd700" :
                    k === "VRF Seed" || k === "Deck Seed"     ? "#a855f7" : undefined
                  }
                />
              ))}
            </div>
          )}

          {result.events.length === 0 && result.transfers.length === 0 && !result.vrfData && !result.roundData && (
            <div className="card" style={{ textAlign: "center", padding: "2rem", color: "#8888aa" }}>
              No recognisable game events found in this transaction.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
function VerifyContent() {
  const searchParams = useSearchParams();
  // preserve ?tab= in URL without breaking anything, just ignored now
  void searchParams;

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto" }}>
      <div style={{ marginBottom: "1.75rem" }}>
        <h1 style={{ fontSize: "clamp(1.4rem, 4vw, 2rem)", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: "0.25rem" }}>
          Verify
        </h1>
        <p style={{ color: "#8888aa", fontSize: "0.875rem" }}>
          Paste any transaction hash to decode bet events, Chainlink VRF randomness, and full on-chain round state.
        </p>
      </div>

      <TxVerifyTab />
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div style={{ color: "#8888aa", padding: "3rem" }}>Loading…</div>}>
      <VerifyContent />
    </Suspense>
  );
}
