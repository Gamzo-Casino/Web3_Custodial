import Link from "next/link";
import HomeGamesGrid from "@/components/HomeGamesGrid";

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Server commits",
    body: "Before you bet, the server hashes its seed and shows you the commitment. The outcome is already locked — you just can't see it yet.",
    color: "#00ff9d",
  },
  {
    step: "02",
    title: "You add entropy",
    body: "Set your own client seed. Your randomness mixes into every outcome via HMAC-SHA256, so the house can never manipulate results.",
    color: "#00d4ff",
  },
  {
    step: "03",
    title: "Outcome is computed",
    body: "RNG = HMAC-SHA256(serverSeed, clientSeed + publicSeed + nonce). A deterministic, tamper-proof formula both sides can verify.",
    color: "#a855f7",
  },
  {
    step: "04",
    title: "Seed is revealed",
    body: "After settlement the server reveals the original seed. You can hash it yourself and confirm it matches the commitment made upfront.",
    color: "#ffd700",
  },
];

const PLATFORM_FEATURES = [
  {
    title: "Provably Fair",
    body: "Every bet is verifiable using open cryptography. HMAC-SHA256 seeds, public nonces — verify any outcome yourself in seconds.",
    color: "#00ff9d",
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M14 3 L4 7 L4 14 C4 19.5 8.4 24.6 14 26 C19.6 24.6 24 19.5 24 14 L24 7 Z" fill="rgba(0,255,157,0.15)" stroke="#00ff9d" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M9 14 L12.5 17.5 L19 11" stroke="#00ff9d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Instant Settlement",
    body: "Wins credit to your wallet immediately. No delays, no withdrawal queues. Your balance updates the moment the round resolves.",
    color: "#00d4ff",
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <circle cx="14" cy="14" r="10" fill="rgba(0,212,255,0.15)" stroke="#00d4ff" strokeWidth="1.5" />
        <path d="M14 8 L14 14 L18 17" stroke="#00d4ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Full Audit Trail",
    body: "Every bet, seed, and payout is permanently logged. Filter by game, view P&L, and export your complete history at any time.",
    color: "#a855f7",
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="5" y="4" width="18" height="22" rx="3" fill="rgba(168,85,247,0.15)" stroke="#a855f7" strokeWidth="1.5" />
        <line x1="9" y1="10" x2="19" y2="10" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="9" y1="14" x2="19" y2="14" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="9" y1="18" x2="15" y2="18" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "10 Games",
    body: "PvP coin flips, solo dice, roulette, blackjack, aviator, and more. Every game shares the same fair RNG engine.",
    color: "#ff9d00",
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="4" y="8" width="20" height="14" rx="3" fill="rgba(255,157,0,0.15)" stroke="#ff9d00" strokeWidth="1.5" />
        <path d="M4 12 L24 12" stroke="#ff9d00" strokeWidth="1.5" />
        <circle cx="9" cy="17" r="2" fill="#ff9d00" opacity="0.7" />
        <path d="M13 16 L20 16 M13 18 L17 18" stroke="#ff9d00" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function HomePage() {
  return (
    <div>
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section style={{ position: "relative", textAlign: "center", padding: "clamp(3rem, 8vw, 6rem) 1rem clamp(3rem, 6vw, 5rem)", overflow: "hidden" }}>
        {/* Radial glow blobs */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0,
          background: "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(0,255,157,0.07) 0%, transparent 70%)",
        }} />
        <div style={{
          position: "absolute", top: "25%", left: "8%", width: "320px", height: "320px",
          borderRadius: "50%", background: "radial-gradient(circle, rgba(0,212,255,0.055) 0%, transparent 70%)",
          pointerEvents: "none", zIndex: 0,
        }} />
        <div style={{
          position: "absolute", top: "15%", right: "6%", width: "260px", height: "260px",
          borderRadius: "50%", background: "radial-gradient(circle, rgba(168,85,247,0.055) 0%, transparent 70%)",
          pointerEvents: "none", zIndex: 0,
        }} />

        <div style={{ position: "relative", zIndex: 1 }}>
          {/* Live badge */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "0.5rem",
            background: "rgba(0,255,157,0.08)", border: "1px solid rgba(0,255,157,0.2)",
            borderRadius: "999px", padding: "0.375rem 1.125rem",
            fontSize: "0.72rem", fontWeight: 700, color: "#00ff9d",
            letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "2rem",
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", background: "#00ff9d",
              display: "inline-block", boxShadow: "0 0 6px #00ff9d",
            }} />
            10 Games · Provably Fair · No House Tricks
          </div>

          {/* Headline */}
          <h1 style={{
            fontSize: "clamp(2rem, 7vw, 5.5rem)",
            fontWeight: 900, lineHeight: 1.05,
            letterSpacing: "clamp(-1px, -0.03em, -3px)", marginBottom: "1.5rem", color: "#f0f0ff",
          }}>
            The Casino That<br />
            <span style={{
              background: "linear-gradient(135deg, #00ff9d 0%, #00d4ff 50%, #a855f7 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            }}>
              Shows Its Math.
            </span>
          </h1>

          <p style={{
            fontSize: "clamp(0.9rem, 2.5vw, 1.15rem)", color: "#8888aa",
            maxWidth: "560px", margin: "0 auto 2.25rem", lineHeight: 1.75,
          }}>
            Connect your wallet to play — no sign-up, no email, no password.
            Every outcome is generated with HMAC-SHA256 and fully verifiable.
          </p>

          <div className="cta-row">
            <Link href="/dashboard" className="btn-primary" style={{ fontSize: "1rem", padding: "0.8rem 2.25rem", borderRadius: "10px" }}>
              Connect Wallet &amp; Play →
            </Link>
            <Link href="/verify" className="btn-ghost" style={{ fontSize: "1rem", padding: "0.8rem 2.25rem", borderRadius: "10px" }}>
              Verify a Bet
            </Link>
          </div>

          {/* Stats row */}
          <div className="hero-stats" style={{ marginTop: "3rem" }}>
            {[
              { value: "10",   label: "Games" },
              { value: "100%", label: "Provably Fair" },
              { value: "10%",  label: "Fee on Profit Only" },
              { value: "∞",    label: "Audit Trail" },
            ].map(({ value, label }) => (
              <div key={label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "1.625rem", fontWeight: 800, color: "#00ff9d", lineHeight: 1, textShadow: "0 0 16px rgba(0,255,157,0.35)" }}>{value}</div>
                <div style={{ fontSize: "0.72rem", color: "#555577", marginTop: "0.25rem", letterSpacing: "0.04em" }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Games Showcase ────────────────────────────────────────────────── */}
      <section style={{ marginBottom: "5rem" }}>
        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <h2 style={{
            fontSize: "clamp(1.5rem, 3vw, 2.25rem)", fontWeight: 800,
            letterSpacing: "-0.5px", color: "#f0f0ff", marginBottom: "0.5rem",
          }}>
            10 Games, All Provably Fair
          </h2>
          <p style={{ color: "#8888aa", fontSize: "0.9375rem" }}>
            From solo dice to live blackjack — every game uses the same verified RNG.
          </p>
        </div>
        <HomeGamesGrid />
      </section>

      {/* ── How Provably Fair Works ───────────────────────────────────────── */}
      <section style={{ marginBottom: "5rem" }}>
        <div style={{ textAlign: "center", marginBottom: "3rem" }}>
          <div style={{
            display: "inline-block", fontSize: "0.72rem", fontWeight: 700,
            letterSpacing: "0.1em", textTransform: "uppercase", color: "#00d4ff",
            background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)",
            borderRadius: "99px", padding: "0.3rem 0.9rem", marginBottom: "0.875rem",
          }}>
            Zero Trust Required
          </div>
          <h2 style={{
            fontSize: "clamp(1.5rem, 3vw, 2.25rem)", fontWeight: 800,
            letterSpacing: "-0.5px", color: "#f0f0ff", marginBottom: "0.5rem",
          }}>
            How Provably Fair Works
          </h2>
          <p style={{ color: "#8888aa", fontSize: "0.9375rem", maxWidth: "480px", margin: "0 auto" }}>
            A four-step cryptographic protocol that proves outcomes were never manipulated.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1.25rem" }}>
          {HOW_IT_WORKS.map(({ step, title, body, color }) => (
            <div key={step} className="card" style={{
              borderColor: `${color}20`, background: `${color}04`,
              position: "relative", paddingTop: "1.75rem",
            }}>
              <div style={{
                position: "absolute", top: "-1px", left: "1.25rem",
                fontSize: "0.58rem", fontWeight: 800, letterSpacing: "0.1em",
                color, background: `${color}14`, border: `1px solid ${color}28`,
                borderRadius: "0 0 8px 8px", padding: "0.15rem 0.6rem",
              }}>
                STEP {step}
              </div>
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                background: `${color}15`, border: `1.5px solid ${color}35`,
                display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: "1rem",
              }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
              </div>
              <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#f0f0ff", marginBottom: "0.5rem" }}>{title}</h3>
              <p style={{ fontSize: "0.825rem", color: "#8888aa", lineHeight: 1.65 }}>{body}</p>
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center", marginTop: "2rem" }}>
          <Link href="/verify" className="btn-ghost" style={{ fontSize: "0.875rem" }}>
            Verify a Past Bet →
          </Link>
        </div>
      </section>

      {/* ── Platform Features ─────────────────────────────────────────────── */}
      <section style={{ marginBottom: "5rem" }}>
        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <h2 style={{
            fontSize: "clamp(1.5rem, 3vw, 2.25rem)", fontWeight: 800,
            letterSpacing: "-0.5px", color: "#f0f0ff",
          }}>
            Built Different
          </h2>
          <p style={{ color: "#8888aa", fontSize: "0.9375rem", marginTop: "0.5rem" }}>
            Fair by design. Transparent by default.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1.25rem" }}>
          {PLATFORM_FEATURES.map(({ icon, title, body, color }) => (
            <div key={title} className="card" style={{ borderColor: `${color}18` }}>
              <div style={{
                width: 52, height: 52, borderRadius: "12px",
                background: `${color}10`, border: `1px solid ${color}22`,
                display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: "1rem",
              }}>
                {icon}
              </div>
              <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#f0f0ff", marginBottom: "0.5rem" }}>{title}</h3>
              <p style={{ fontSize: "0.825rem", color: "#8888aa", lineHeight: 1.65 }}>{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA Banner ────────────────────────────────────────────────────── */}
      <section style={{
        background: "linear-gradient(135deg, #0c1f13 0%, #0a0a1a 45%, #0e0d28 100%)",
        border: "1px solid rgba(0,255,157,0.14)",
        borderRadius: "20px", padding: "clamp(2.5rem, 6vw, 4.5rem) clamp(1.25rem, 4vw, 2rem)",
        textAlign: "center", marginBottom: "4rem",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse 55% 65% at 50% 100%, rgba(0,255,157,0.07) 0%, transparent 70%)",
        }} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{
            fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.1em",
            textTransform: "uppercase", color: "#00ff9d", marginBottom: "1rem",
          }}>
            No Sign-Up Required
          </div>
          <h2 style={{
            fontSize: "clamp(1.75rem, 4vw, 3rem)", fontWeight: 900,
            letterSpacing: "-1px", color: "#f0f0ff", marginBottom: "1rem",
          }}>
            Ready to Play Fair?
          </h2>
          <p style={{
            color: "#8888aa", fontSize: "1rem", maxWidth: "420px",
            margin: "0 auto 2.25rem", lineHeight: 1.7,
          }}>
            Just connect your wallet — no email, no password, no sign-up.
            Every outcome is verifiable from your very first bet.
          </p>
          <div className="cta-row">
            <Link href="/dashboard" className="btn-primary" style={{ fontSize: "1rem", padding: "0.8rem 2.25rem" }}>
              Connect Wallet &amp; Play →
            </Link>
            <Link href="/verify" className="btn-ghost" style={{ fontSize: "1rem", padding: "0.8rem 2.25rem" }}>
              Verify a Bet
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
