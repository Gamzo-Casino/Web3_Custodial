"use client";

import { useState, useEffect, type FormEvent } from "react";
import type { WalletUser } from "@/lib/web3/hooks/useWalletAuth";

interface ProfileModalProps {
  user: WalletUser;
  onClose: () => void;
  onUpdated: (user: WalletUser) => void;
}

export default function ProfileModal({ user, onClose, onUpdated }: ProfileModalProps) {
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Reset on user change
  useEffect(() => {
    setName(user.name ?? "");
    setEmail(user.email ?? "");
    setStatus("idle");
    setErrorMsg("");
  }, [user.id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg("");

    try {
      const res = await fetch("/api/wallet/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || null,
          email: email.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error ?? "Failed to save profile");
        setStatus("error");
        return;
      }

      setStatus("success");
      onUpdated(data.user);
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setErrorMsg("Network error — please try again");
      setStatus("error");
    }
  }

  const truncateAddress = (addr: string) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

  const memberSince = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    // Backdrop
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      {/* Modal panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0d0d1f",
          border: "1px solid #2a2a50",
          borderRadius: "16px",
          padding: "2rem",
          width: "100%",
          maxWidth: "420px",
          boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1.5rem",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "1.2rem",
              fontWeight: 700,
              color: "#e0e0ff",
            }}
          >
            Profile
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              color: "#888",
              fontSize: "1.4rem",
              cursor: "pointer",
              lineHeight: 1,
              padding: "0.2rem",
            }}
          >
            ×
          </button>
        </div>

        {/* Wallet address */}
        <div style={{ marginBottom: "1.25rem" }}>
          <label
            style={{ fontSize: "0.75rem", color: "#888", display: "block", marginBottom: "0.3rem" }}
          >
            Wallet Address
          </label>
          <div
            style={{
              background: "#13132b",
              border: "1px solid #2a2a50",
              borderRadius: "8px",
              padding: "0.6rem 0.875rem",
              fontSize: "0.875rem",
              fontFamily: "monospace",
              color: "#00ff9d",
              letterSpacing: "0.02em",
            }}
          >
            {truncateAddress(user.walletAddress)}
          </div>
        </div>

        {/* Member since */}
        {memberSince && (
          <div style={{ marginBottom: "1.5rem" }}>
            <label
              style={{
                fontSize: "0.75rem",
                color: "#888",
                display: "block",
                marginBottom: "0.3rem",
              }}
            >
              Member Since
            </label>
            <div style={{ fontSize: "0.875rem", color: "#b0b0d0" }}>{memberSince}</div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {/* Display Name */}
          <div style={{ marginBottom: "1rem" }}>
            <label
              htmlFor="profile-name"
              style={{
                fontSize: "0.8rem",
                color: "#b0b0d0",
                display: "block",
                marginBottom: "0.4rem",
              }}
            >
              Display Name
            </label>
            <input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              placeholder="e.g. CryptoAce"
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "#13132b",
                border: "1px solid #2a2a50",
                borderRadius: "8px",
                padding: "0.6rem 0.875rem",
                color: "#e0e0ff",
                fontSize: "0.9rem",
                outline: "none",
              }}
            />
          </div>

          {/* Email */}
          <div style={{ marginBottom: "1.5rem" }}>
            <label
              htmlFor="profile-email"
              style={{
                fontSize: "0.8rem",
                color: "#b0b0d0",
                display: "block",
                marginBottom: "0.4rem",
              }}
            >
              Email{" "}
              <span style={{ color: "#555", fontSize: "0.75rem" }}>(optional)</span>
            </label>
            <input
              id="profile-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "#13132b",
                border: "1px solid #2a2a50",
                borderRadius: "8px",
                padding: "0.6rem 0.875rem",
                color: "#e0e0ff",
                fontSize: "0.9rem",
                outline: "none",
              }}
            />
          </div>

          {/* Error */}
          {status === "error" && (
            <div
              style={{
                background: "rgba(255,77,77,0.12)",
                border: "1px solid rgba(255,77,77,0.3)",
                borderRadius: "8px",
                padding: "0.6rem 0.875rem",
                color: "#ff8080",
                fontSize: "0.85rem",
                marginBottom: "1rem",
              }}
            >
              {errorMsg}
            </div>
          )}

          {/* Success */}
          {status === "success" && (
            <div
              style={{
                background: "rgba(0,255,157,0.08)",
                border: "1px solid rgba(0,255,157,0.25)",
                borderRadius: "8px",
                padding: "0.6rem 0.875rem",
                color: "#00ff9d",
                fontSize: "0.85rem",
                marginBottom: "1rem",
              }}
            >
              Profile saved!
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={status === "saving"}
            style={{
              width: "100%",
              padding: "0.7rem",
              background: status === "saving" ? "#1a3a2a" : "#00ff9d",
              color: status === "saving" ? "#00cc7a" : "#0a0a1a",
              border: "none",
              borderRadius: "10px",
              fontWeight: 700,
              fontSize: "0.95rem",
              cursor: status === "saving" ? "not-allowed" : "pointer",
              transition: "opacity 0.2s",
            }}
          >
            {status === "saving" ? "Saving…" : "Save Profile"}
          </button>
        </form>
      </div>
    </div>
  );
}
