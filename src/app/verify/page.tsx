"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────────
type TxEvent = {
  game: string;
  event: string;
  logIndex: number;
  address: string;
  fields: Record<string, string>;
};

type TxResult = {
  txHash: string;
  status: string;
  block: string;
  gasUsed: string;
  from: string;
  fromShort: string;
  to: string | null;
  toShort: string;
  game: string;
  outcome: string;
  netPayout: string;
  events: TxEvent[];
  transfers: { from: string; to: string; amount: string }[];
  explorerUrl: string;
};

type SeedResult = {
  outcome: string;
  rngVersion: number;
  hmacHex: string;
  firstByte: number;
  highNibble: number;
  floatValue: number;
  computedHash: string;
  hashVerified: boolean | null;
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

function InputField({ label, value, onChange, placeholder, mono = true }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean;
}) {
  return (
    <div>
      <label style={{
        display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#8888aa",
        letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.4rem",
      }}>{label}</label>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%", background: "#0d0d1a", border: "1px solid #2a2a50",
          borderRadius: "8px", padding: "0.6rem 0.875rem", color: "#f0f0ff",
          fontSize: "0.875rem", fontFamily: mono ? "monospace" : "inherit",
          outline: "none", boxSizing: "border-box",
        }}
      />
    </div>
  );
}

// ── TX Hash Tab ────────────────────────────────────────────────────────────────
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
    if (o.includes("WIN") || o === "Won")    return "#00ff9d";
    if (o === "Lost" || o.includes("LOSS"))  return "#ff8080";
    if (o === "Success")                     return "#00ff9d";
    if (o === "Failed")                      return "#ff8080";
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

            <DataRow label="Tx Hash"   value={result.txHash} />
            <DataRow label="Status"    value={result.status}  mono={false} accent={result.status === "Success" ? "#00ff9d" : "#ff8080"} />
            <DataRow label="Block"     value={`#${result.block}`} />
            <DataRow label="Gas Used"  value={Number(result.gasUsed).toLocaleString()} mono={false} />
            <DataRow label="From"      value={result.from} />
            <DataRow label="To"        value={result.to ?? "—"} />
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

          {/* Event logs */}
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
                        v === "✗ LOSS" ? "#ff8080" :
                        k === "Net Payout" ? "#00ff9d" :
                        k === "Multiplier" ? "#ffd700" : undefined
                      }
                    />
                  ))}
                </div>
              ))}
            </div>
          )}

          {result.events.length === 0 && result.transfers.length === 0 && (
            <div className="card" style={{ textAlign: "center", padding: "2rem", color: "#8888aa" }}>
              No recognisable game events found in this transaction.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Seed Verify Tab ────────────────────────────────────────────────────────────
function SeedVerifyTab() {
  const searchParams = useSearchParams();

  const [serverSeed, setServerSeed] = useState(searchParams.get("serverSeed") ?? "");
  const [clientSeed, setClientSeed] = useState(searchParams.get("clientSeed") ?? "");
  const [publicSeed, setPublicSeed] = useState(searchParams.get("publicSeed") ?? "");
  const [nonce,      setNonce]      = useState(searchParams.get("nonce") ?? "1");
  const [commitHash, setCommitHash] = useState(searchParams.get("commitHash") ?? "");
  const [result,     setResult]     = useState<SeedResult | null>(null);
  const [error,      setError]      = useState("");

  useEffect(() => {
    if (serverSeed && clientSeed && publicSeed) {
      doVerify(serverSeed, clientSeed, publicSeed, parseInt(nonce) || 1, commitHash);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function doVerify(ss: string, cs: string, ps: string, n: number, ch: string) {
    if (!ss || !cs || !ps) { setError("Server seed, client seed and public seed are required"); return; }
    setError(""); setResult(null);
    const body: Record<string, unknown> = { serverSeed: ss, clientSeed: cs, publicSeed: ps, nonce: n };
    if (ch) body.commitHash = ch;
    fetch("/api/coinflip/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(d => d.error ? setError(d.error) : setResult(d as SeedResult))
      .catch(() => setError("Verification failed — check your inputs"));
  }

  return (
    <div>
      {/* Algorithm explanation */}
      <div className="card" style={{ marginBottom: "1.25rem", background: "rgba(0,212,255,0.05)", borderColor: "rgba(0,212,255,0.2)" }}>
        <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "#00d4ff", marginBottom: "0.5rem" }}>Algorithm v1</div>
        <ol style={{ color: "#8888aa", fontSize: "0.82rem", lineHeight: 1.7, paddingLeft: "1.25rem", margin: 0 }}>
          <li>Server commits to <strong style={{ color: "#f0f0ff" }}>serverSeed</strong> by publishing <code style={{ color: "#00ff9d" }}>SHA-256(serverSeed)</code> before the bet.</li>
          <li><code style={{ color: "#00ff9d" }}>bytes = HMAC-SHA256(serverSeed, "clientSeed:publicSeed:nonce")</code></li>
          <li>High nibble of <code>bytes[0]</code>: even → HEADS, odd → TAILS.</li>
          <li>After settlement the serverSeed is revealed — verify <code style={{ color: "#00ff9d" }}>SHA-256(serverSeed) = commitHash</code>.</li>
        </ol>
      </div>

      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <form onSubmit={e => { e.preventDefault(); doVerify(serverSeed, clientSeed, publicSeed, parseInt(nonce) || 1, commitHash); }}
          style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <InputField label="Server Seed (revealed after settlement)" value={serverSeed} onChange={setServerSeed} placeholder="64-char hex string" />
          <InputField label="Client Seed" value={clientSeed} onChange={setClientSeed} placeholder="hex string" />
          <InputField label="Public Seed (matchId:playerBId)" value={publicSeed} onChange={setPublicSeed} placeholder="matchId:playerBId" />
          <InputField label="Nonce" value={nonce} onChange={setNonce} placeholder="1" mono={false} />
          <InputField label="Commitment Hash (optional)" value={commitHash} onChange={setCommitHash} placeholder="SHA-256 of server seed" />

          {error && (
            <div style={{ padding: "0.625rem 0.875rem", borderRadius: "8px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.3)", color: "#ff8080", fontSize: "0.875rem" }}>
              {error}
            </div>
          )}
          <button type="submit" className="btn-primary">Verify Outcome</button>
        </form>
      </div>

      {result && (
        <>
          <div className="card" style={{
            marginBottom: "1rem", textAlign: "center",
            background: result.outcome === "HEADS" ? "rgba(0,255,157,0.07)" : "rgba(155,89,255,0.07)",
            borderColor: result.outcome === "HEADS" ? "rgba(0,255,157,0.3)" : "rgba(155,89,255,0.3)",
          }}>
            <div style={{ fontSize: "0.7rem", color: "#8888aa", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Computed Outcome · RNG v{result.rngVersion}
            </div>
            <div style={{ fontSize: "2.5rem", fontWeight: 900, color: result.outcome === "HEADS" ? "#00ff9d" : "#9b59ff" }}>
              {result.outcome}
            </div>
          </div>

          {result.hashVerified !== null && (
            <div className="card" style={{
              marginBottom: "1rem",
              background: result.hashVerified ? "rgba(0,255,157,0.05)" : "rgba(255,80,80,0.05)",
              borderColor: result.hashVerified ? "rgba(0,255,157,0.25)" : "rgba(255,80,80,0.25)",
            }}>
              <div style={{ fontWeight: 700, marginBottom: "0.5rem", color: result.hashVerified ? "#00ff9d" : "#ff8080" }}>
                {result.hashVerified ? "✓ Commitment verified" : "✗ Commitment mismatch"}
              </div>
              <DataRow label="SHA-256(serverSeed)" value={result.computedHash} />
            </div>
          )}

          <div className="card">
            <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.75rem", color: "#f0f0ff" }}>Derived Random Stream</div>
            <DataRow label="HMAC-SHA256 (32 bytes)"    value={result.hmacHex} />
            <DataRow label="bytes[0] decimal"          value={String(result.firstByte)} />
            <DataRow label="High nibble (>> 4)"        value={String(result.highNibble)} />
            <DataRow label="High nibble even?"         value={result.highNibble % 2 === 0 ? "Yes → HEADS" : "No → TAILS"} mono={false}
              accent={result.outcome === "HEADS" ? "#00ff9d" : "#9b59ff"} />
            <DataRow label="Float [0, 1) 52-bit"       value={result.floatValue.toFixed(10)} />
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
function VerifyContent() {
  const searchParams = useSearchParams();
  const defaultTab   = searchParams.get("tab") === "seed" ? "seed" : "tx";
  const [tab, setTab] = useState<"tx" | "seed">(defaultTab as "tx" | "seed");

  const tabs = [
    { key: "tx",   label: "🔍 TX Hash Lookup",  desc: "Paste a transaction hash to decode all bet events" },
    { key: "seed", label: "🔑 Seed Verify",      desc: "Reproduce any outcome from revealed seeds" },
  ];

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto" }}>
      <div style={{ marginBottom: "1.75rem" }}>
        <h1 style={{ fontSize: "clamp(1.4rem, 4vw, 2rem)", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: "0.25rem" }}>
          Verify
        </h1>
        <p style={{ color: "#8888aa", fontSize: "0.875rem" }}>
          Look up any bet by transaction hash or independently reproduce outcomes from revealed seeds.
        </p>
      </div>

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {tabs.map(t => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key as "tx" | "seed")} style={{
              flex: 1, minWidth: "200px", padding: "0.875rem 1rem", borderRadius: "12px", cursor: "pointer",
              border: `1px solid ${active ? "#00d4ff44" : "#2a2a50"}`,
              background: active ? "rgba(0,212,255,0.08)" : "rgba(255,255,255,0.02)",
              textAlign: "left", transition: "all 0.15s",
            }}>
              <div style={{ fontSize: "0.875rem", fontWeight: 700, color: active ? "#00d4ff" : "#f0f0ff", marginBottom: "0.2rem" }}>
                {t.label}
              </div>
              <div style={{ fontSize: "0.7rem", color: "#555577" }}>{t.desc}</div>
            </button>
          );
        })}
      </div>

      {tab === "tx"   && <TxVerifyTab />}
      {tab === "seed" && <SeedVerifyTab />}
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
