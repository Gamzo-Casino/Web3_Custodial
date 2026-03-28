"use client";

import { useState } from "react";
import Link from "next/link";

interface FairnessWidgetProps {
  /** SHA-256 commitment of the active server seed — safe to display. */
  serverSeedHash: string;
  /** Player-settable client seed. */
  clientSeed: string;
  /** Number of bets placed as Player A with the current server seed. */
  nonce: number;
  /**
   * Revealed server seed — only set after the bet settles.
   * When provided, the widget shows the reveal section.
   */
  revealedServerSeed?: string | null;
  /**
   * Query-string to pre-fill the verify page (serverSeed, clientSeed, publicSeed, nonce).
   * When provided, a "Verify this bet" link is shown.
   */
  verifyParams?: string | null;
  /** Called when the user submits a new client seed. */
  onClientSeedChange?: (newSeed: string) => Promise<void>;
}

const LABEL: React.CSSProperties = {
  fontSize: "0.7rem",
  fontWeight: 600,
  color: "#8888aa",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: "0.25rem",
};

const MONO_VALUE: React.CSSProperties = {
  fontSize: "0.8rem",
  color: "#f0f0ff",
  fontFamily: "monospace",
  wordBreak: "break-all",
};

const MUTED_VALUE: React.CSSProperties = {
  ...MONO_VALUE,
  color: "#8888aa",
};

function InfoRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div
      style={{
        padding: "0.625rem 0.875rem",
        background: "#0d0d1a",
        borderRadius: "8px",
        border: "1px solid #2a2a50",
      }}
    >
      <div style={LABEL}>{label}</div>
      <div style={muted ? MUTED_VALUE : MONO_VALUE}>{value}</div>
    </div>
  );
}

export default function FairnessWidget({
  serverSeedHash,
  clientSeed: initialClientSeed,
  nonce,
  revealedServerSeed,
  verifyParams,
  onClientSeedChange,
}: FairnessWidgetProps) {
  const [clientSeed, setClientSeed] = useState(initialClientSeed);
  const [editSeed, setEditSeed] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const isSettled = !!revealedServerSeed;

  async function handleSave() {
    if (!editSeed.trim() || !onClientSeedChange) return;
    setSaving(true);
    setSaveError("");
    try {
      await onClientSeedChange(editSeed.trim());
      setClientSeed(editSeed.trim());
      setEditing(false);
      setEditSeed("");
    } catch {
      setSaveError("Failed to update client seed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        background: "rgba(0,212,255,0.03)",
        border: "1px solid rgba(0,212,255,0.15)",
        borderRadius: "12px",
        padding: "1.25rem",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1rem",
        }}
      >
        <h3
          style={{
            fontSize: "0.9375rem",
            fontWeight: 700,
            color: "#00d4ff",
            margin: 0,
          }}
        >
          Provably Fair
        </h3>
        <span
          style={{
            fontSize: "0.7rem",
            fontWeight: 600,
            color: "#8888aa",
            background: "rgba(136,136,170,0.1)",
            padding: "0.125rem 0.5rem",
            borderRadius: "99px",
          }}
        >
          RNG v1
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
        {/* Server seed commitment */}
        <InfoRow
          label="Server Seed Hash (SHA-256 commitment)"
          value={serverSeedHash}
        />

        {/* Revealed server seed (post-settlement only) */}
        {isSettled ? (
          <div
            style={{
              padding: "0.625rem 0.875rem",
              background: "rgba(0,255,157,0.05)",
              borderRadius: "8px",
              border: "1px solid rgba(0,255,157,0.2)",
            }}
          >
            <div style={{ ...LABEL, color: "#00ff9d" }}>Server Seed (revealed)</div>
            <div style={MONO_VALUE}>{revealedServerSeed}</div>
          </div>
        ) : (
          <InfoRow
            label="Server Seed (hidden until match resolves)"
            value="Hidden — revealed after settlement"
            muted
          />
        )}

        {/* Client seed */}
        <div
          style={{
            padding: "0.625rem 0.875rem",
            background: "#0d0d1a",
            borderRadius: "8px",
            border: "1px solid #2a2a50",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "0.25rem",
            }}
          >
            <div style={LABEL}>Client Seed</div>
            {!isSettled && onClientSeedChange && (
              <button
                onClick={() => {
                  setEditing(!editing);
                  setEditSeed(clientSeed);
                  setSaveError("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#00d4ff",
                  fontSize: "0.7rem",
                  cursor: "pointer",
                  padding: 0,
                  fontWeight: 600,
                }}
              >
                {editing ? "Cancel" : "Change"}
              </button>
            )}
          </div>
          {editing ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <input
                type="text"
                value={editSeed}
                onChange={(e) => setEditSeed(e.target.value)}
                maxLength={128}
                style={{
                  width: "100%",
                  background: "#12122a",
                  border: "1px solid #3a3a60",
                  borderRadius: "6px",
                  padding: "0.375rem 0.625rem",
                  color: "#f0f0ff",
                  fontSize: "0.8rem",
                  fontFamily: "monospace",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {saveError && (
                <div style={{ color: "#ff8080", fontSize: "0.75rem" }}>{saveError}</div>
              )}
              <button
                onClick={handleSave}
                disabled={saving || !editSeed.trim()}
                style={{
                  padding: "0.375rem 0.75rem",
                  borderRadius: "6px",
                  background: "rgba(0,255,157,0.15)",
                  border: "1px solid rgba(0,255,157,0.3)",
                  color: "#00ff9d",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  opacity: saving || !editSeed.trim() ? 0.5 : 1,
                }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          ) : (
            <div style={MONO_VALUE}>{clientSeed}</div>
          )}
        </div>

        {/* Nonce */}
        <InfoRow label="Nonce (bets placed with this server seed)" value={String(nonce)} />
      </div>

      {/* Verify link (post-settlement) */}
      {isSettled && verifyParams && (
        <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #2a2a50" }}>
          <div style={{ fontSize: "0.8rem", color: "#8888aa", marginBottom: "0.5rem" }}>
            Independently verify this outcome using the revealed seeds:
          </div>
          <Link
            href={`/verify?${verifyParams}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              padding: "0.5rem 0.875rem",
              borderRadius: "8px",
              background: "rgba(0,212,255,0.1)",
              border: "1px solid rgba(0,212,255,0.25)",
              color: "#00d4ff",
              fontSize: "0.875rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Verify this bet →
          </Link>
        </div>
      )}

      {/* How it works */}
      {!isSettled && (
        <div
          style={{
            marginTop: "1rem",
            paddingTop: "1rem",
            borderTop: "1px solid #2a2a50",
            fontSize: "0.75rem",
            color: "#8888aa",
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: "#f0f0ff" }}>Algorithm v1:</strong>{" "}
          <code style={{ fontFamily: "monospace", color: "#00ff9d" }}>
            HMAC-SHA256(serverSeed, &quot;clientSeed:publicSeed:nonce&quot;)
          </code>
          {" — high nibble of first byte: even=HEADS, odd=TAILS."}
        </div>
      )}
    </div>
  );
}
