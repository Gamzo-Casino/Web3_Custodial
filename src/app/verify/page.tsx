"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type VerifyResult = {
  outcome: "HEADS" | "TAILS";
  rngVersion: number;
  hmacHex: string;
  firstByte: number;
  highNibble: number;
  floatValue: number;
  computedHash: string;
  hashVerified: boolean | null;
};

function SeedInput({
  label,
  value,
  onChange,
  placeholder,
  mono = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: "0.75rem",
          fontWeight: 600,
          color: "#8888aa",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: "0.5rem",
        }}
      >
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          background: "#0d0d1a",
          border: "1px solid #2a2a50",
          borderRadius: "8px",
          padding: "0.625rem 0.875rem",
          color: "#f0f0ff",
          fontSize: "0.875rem",
          fontFamily: mono ? "monospace" : "inherit",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function DataRow({ label, value, mono = true, accent }: { label: string; value: string; mono?: boolean; accent?: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "1rem",
        padding: "0.5rem 0",
        borderBottom: "1px solid #1a1a35",
      }}
    >
      <span style={{ fontSize: "0.8rem", color: "#8888aa", flexShrink: 0 }}>{label}</span>
      <span
        style={{
          fontSize: "0.8rem",
          color: accent ?? "#f0f0ff",
          fontFamily: mono ? "monospace" : "inherit",
          wordBreak: "break-all",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function VerifyForm() {
  const searchParams = useSearchParams();

  const [serverSeed, setServerSeed] = useState(searchParams.get("serverSeed") ?? "");
  const [clientSeed, setClientSeed] = useState(searchParams.get("clientSeed") ?? "");
  const [publicSeed, setPublicSeed] = useState(searchParams.get("publicSeed") ?? "");
  const [nonce, setNonce] = useState(searchParams.get("nonce") ?? "1");
  const [commitHash, setCommitHash] = useState(searchParams.get("commitHash") ?? "");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (serverSeed && clientSeed && publicSeed) {
      doVerify(serverSeed, clientSeed, publicSeed, parseInt(nonce) || 1, commitHash);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function doVerify(ss: string, cs: string, ps: string, n: number, ch: string) {
    if (!ss || !cs || !ps) {
      setError("Server seed, client seed and public seed are required");
      setResult(null);
      return;
    }

    setError("");
    setResult(null);

    const body: Record<string, unknown> = {
      serverSeed: ss,
      clientSeed: cs,
      publicSeed: ps,
      nonce: n,
    };
    if (ch) body.commitHash = ch;

    fetch("/api/coinflip/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
        } else {
          setResult(d as VerifyResult);
        }
      })
      .catch(() => setError("Verification failed — check your inputs"));
  }

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    doVerify(serverSeed, clientSeed, publicSeed, parseInt(nonce) || 1, commitHash);
  }

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.875rem", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: "0.25rem" }}>
          Verify Fairness
        </h1>
        <p style={{ color: "#8888aa", fontSize: "0.875rem" }}>
          Independently reproduce any bet outcome using the revealed seeds and the open algorithm.
        </p>
      </div>

      {/* How it works */}
      <div
        className="card"
        style={{
          marginBottom: "1.5rem",
          background: "rgba(0,212,255,0.05)",
          borderColor: "rgba(0,212,255,0.2)",
        }}
      >
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "0.75rem", color: "#00d4ff" }}>
          Algorithm v1
        </h2>
        <ol
          style={{
            color: "#8888aa",
            fontSize: "0.875rem",
            lineHeight: 1.7,
            paddingLeft: "1.25rem",
            margin: 0,
          }}
        >
          <li>Server commits to <strong style={{ color: "#f0f0ff" }}>serverSeed</strong> by publishing <code style={{ fontFamily: "monospace", color: "#00ff9d" }}>SHA-256(serverSeed)</code> before the bet.</li>
          <li>Player B&apos;s <strong style={{ color: "#f0f0ff" }}>clientSeed</strong> and deterministic <strong style={{ color: "#f0f0ff" }}>publicSeed</strong> are set at join time.</li>
          <li>
            <code style={{ color: "#00ff9d", fontFamily: "monospace" }}>
              bytes = HMAC-SHA256(serverSeed, &quot;clientSeed:publicSeed:nonce&quot;)
            </code>
          </li>
          <li>High nibble of <code style={{ fontFamily: "monospace" }}>bytes[0]</code>: even → HEADS, odd → TAILS.</li>
          <li>After settlement the serverSeed is revealed — verify <code style={{ fontFamily: "monospace", color: "#00ff9d" }}>SHA-256(serverSeed) = commitHash</code>.</li>
        </ol>
      </div>

      {/* Input form */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <form onSubmit={handleVerify} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <SeedInput
            label="Server Seed (revealed after settlement)"
            value={serverSeed}
            onChange={setServerSeed}
            placeholder="64-char hex string"
          />
          <SeedInput
            label="Client Seed (Player B)"
            value={clientSeed}
            onChange={setClientSeed}
            placeholder="hex string"
          />
          <SeedInput
            label="Public Seed (matchId:playerBId)"
            value={publicSeed}
            onChange={setPublicSeed}
            placeholder="matchId:playerBId"
          />
          <SeedInput
            label="Nonce"
            value={nonce}
            onChange={setNonce}
            placeholder="0"
            mono={false}
          />
          <SeedInput
            label="Commitment Hash (optional — for SHA-256 check)"
            value={commitHash}
            onChange={setCommitHash}
            placeholder="SHA-256 of server seed — paste to verify commitment"
          />

          {error && (
            <div
              style={{
                padding: "0.625rem 0.875rem",
                borderRadius: "8px",
                background: "rgba(255,80,80,0.1)",
                border: "1px solid rgba(255,80,80,0.3)",
                color: "#ff8080",
                fontSize: "0.875rem",
              }}
            >
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary">
            Verify Outcome
          </button>
        </form>
      </div>

      {/* Results */}
      {result && !error && (
        <>
          {/* Outcome */}
          <div
            className="card"
            style={{
              marginBottom: "1rem",
              background:
                result.outcome === "HEADS"
                  ? "rgba(0,255,157,0.07)"
                  : "rgba(155,89,255,0.07)",
              borderColor:
                result.outcome === "HEADS"
                  ? "rgba(0,255,157,0.3)"
                  : "rgba(155,89,255,0.3)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "#8888aa", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
              Computed Outcome · RNG v{result.rngVersion}
            </div>
            <div
              style={{
                fontSize: "2.5rem",
                fontWeight: 900,
                color: result.outcome === "HEADS" ? "#00ff9d" : "#9b59ff",
              }}
            >
              {result.outcome}
            </div>
          </div>

          {/* Commitment check */}
          {result.hashVerified !== null && (
            <div
              className="card"
              style={{
                marginBottom: "1rem",
                background: result.hashVerified
                  ? "rgba(0,255,157,0.05)"
                  : "rgba(255,80,80,0.05)",
                borderColor: result.hashVerified
                  ? "rgba(0,255,157,0.25)"
                  : "rgba(255,80,80,0.25)",
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  marginBottom: "0.5rem",
                  color: result.hashVerified ? "#00ff9d" : "#ff8080",
                }}
              >
                {result.hashVerified
                  ? "✓ Commitment verified — SHA-256(serverSeed) matches commitHash"
                  : "✗ Commitment mismatch — serverSeed does NOT match commitHash"}
              </div>
              <DataRow label="SHA-256(serverSeed)" value={result.computedHash} />
            </div>
          )}

          {/* Derived RNG stream */}
          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.75rem", color: "#f0f0ff" }}>
              Derived Random Stream
            </h3>
            <DataRow
              label="HMAC-SHA256 hex (32 bytes)"
              value={result.hmacHex}
            />
            <DataRow
              label="bytes[0] (decimal)"
              value={String(result.firstByte)}
            />
            <DataRow
              label="High nibble (bytes[0] >> 4)"
              value={String(result.highNibble)}
            />
            <DataRow
              label="High nibble is even?"
              value={result.highNibble % 2 === 0 ? "Yes → HEADS" : "No → TAILS"}
              mono={false}
              accent={result.outcome === "HEADS" ? "#00ff9d" : "#9b59ff"}
            />
            <DataRow
              label="Float value [0, 1) — 52-bit extraction"
              value={result.floatValue.toFixed(10)}
            />
          </div>
        </>
      )}

      <div style={{ textAlign: "center" }}>
        <Link href="/coinflip" style={{ color: "#8888aa", fontSize: "0.875rem", textDecoration: "none" }}>
          ← Back to Coin Flip
        </Link>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div style={{ color: "#8888aa", padding: "3rem" }}>Loading…</div>}>
      <VerifyForm />
    </Suspense>
  );
}
