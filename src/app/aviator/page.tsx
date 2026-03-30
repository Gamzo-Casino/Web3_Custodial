"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useWalletUser } from "@/contexts/WalletAuthContext";
import { useAccount } from "wagmi";
import OtherGames from "@/components/OtherGames";
import BetHistory from "@/components/BetHistory";
import FairnessWidget from "@/components/FairnessWidget";
import CasinoChip, { CHIP_OPTIONS } from "@/components/CasinoChip";

// ── Constants ────────────────────────────────────────────────────────────────
const ACCENT = "#ff6b35";
const WIN_COLOR = "#00ff9d";
const LOSE_COLOR = "#ff4444";

/** Must match server AVIATOR_SPEED in src/lib/aviator.ts */
const AVIATOR_SPEED = 0.00006;

function getMultiplierAtTime(elapsedMs: number): number {
  return Math.floor(Math.exp(AVIATOR_SPEED * elapsedMs) * 100) / 100;
}

const AUTO_PRESETS = [
  { label: "Off", value: 0 },
  { label: "1.5×", value: 1.5 },
  { label: "2×", value: 2.0 },
  { label: "5×", value: 5.0 },
  { label: "10×", value: 10.0 },
];

// ── Types ────────────────────────────────────────────────────────────────────
type GamePhase = "idle" | "flying" | "cashed_out" | "crashed";

interface RoundState {
  id: string;
  stakeGzo: number;
  status: string;
  startedAt: string;
  autoCashoutAt: number | null;
  flyAwayPoint?: number;
  cashoutMultiplier?: number | null;
  currentMultiplier?: number;
  elapsedMs?: number;
  serverSeed?: string;
  serverSeedHash?: string;
  clientSeed?: string;
  nonce?: number;
  grossPayoutGzo?: number;
  profitGzo?: number;
  feeGzo?: number;
  netPayoutGzo?: number;
  balanceAfter?: number;
}

interface SeedState {
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

// ── Canvas Animation ─────────────────────────────────────────────────────────
function AviatorCanvas({
  phase,
  multiplier,
  flyAwayPoint,
  cashoutMultiplier,
}: {
  phase: GamePhase;
  multiplier: number;
  flyAwayPoint: number | null;
  cashoutMultiplier: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    function drawJet(
      c: CanvasRenderingContext2D,
      x: number,
      y: number,
      angle: number,
      scale: number,
      alpha: number
    ) {
      c.save();
      c.translate(x, y);
      c.rotate((angle * Math.PI) / 180);
      c.scale(scale, scale);
      c.globalAlpha = alpha;

      // Fuselage
      c.beginPath();
      c.moveTo(18, 0);
      c.lineTo(-8, -5);
      c.lineTo(-14, -3);
      c.lineTo(-14, 3);
      c.lineTo(-8, 5);
      c.closePath();
      c.fillStyle = ACCENT;
      c.fill();

      // Wing
      c.beginPath();
      c.moveTo(2, -1);
      c.lineTo(-6, -12);
      c.lineTo(-10, -10);
      c.lineTo(-4, 0);
      c.closePath();
      c.fillStyle = ACCENT;
      c.globalAlpha = alpha * 0.8;
      c.fill();

      // Bottom wing
      c.beginPath();
      c.moveTo(2, 1);
      c.lineTo(-6, 12);
      c.lineTo(-10, 10);
      c.lineTo(-4, 0);
      c.closePath();
      c.fill();

      // Tail
      c.beginPath();
      c.moveTo(-12, -2);
      c.lineTo(-18, -8);
      c.lineTo(-18, -4);
      c.lineTo(-14, -1);
      c.closePath();
      c.globalAlpha = alpha * 0.7;
      c.fill();

      // Engine glow
      c.beginPath();
      c.arc(-14, 0, 3, 0, Math.PI * 2);
      c.fillStyle = `rgba(255, 200, 50, ${alpha * 0.6})`;
      c.fill();

      c.restore();
    }

    function draw() {
      if (!ctx) return;
      timeRef.current += 0.016;
      const t = timeRef.current;
      ctx.clearRect(0, 0, W, H);

      // Background grid
      ctx.strokeStyle = "rgba(42, 42, 80, 0.15)";
      ctx.lineWidth = 1;
      for (let y = 0; y < H; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      for (let x = 0; x < W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }

      if (phase === "idle") {
        // Pulsing runway + parked jet
        const pulseAlpha = 0.15 + 0.1 * Math.sin(t * 2);
        ctx.strokeStyle = `rgba(255, 107, 53, ${pulseAlpha})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(W * 0.1, H * 0.85);
        ctx.lineTo(W * 0.9, H * 0.85);
        ctx.stroke();
        ctx.setLineDash([]);

        const jx = W * 0.35 + Math.sin(t * 0.5) * 3;
        const jy = H * 0.78;
        drawJet(ctx, jx, jy, 0, 1.2, 0.4 + 0.1 * Math.sin(t * 1.5));

        // "Place a bet" text
        ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Place a bet to start", W / 2, H * 0.5);
      }

      if (phase === "flying") {
        const progress = Math.min(1, (multiplier - 1) / 30);
        const curveX = W * 0.1 + progress * W * 0.75;
        const curveY = H * 0.85 - Math.pow(progress, 0.6) * H * 0.7;
        const angle = -15 - progress * 40;

        // Flight trail
        const trailPoints: Array<{ x: number; y: number }> = [];
        for (let p = 0; p <= progress; p += 0.008) {
          trailPoints.push({
            x: W * 0.1 + p * W * 0.75,
            y: H * 0.85 - Math.pow(p, 0.6) * H * 0.7,
          });
        }

        if (trailPoints.length > 1) {
          ctx.beginPath();
          ctx.moveTo(trailPoints[0].x, trailPoints[0].y);
          for (let i = 1; i < trailPoints.length; i++) {
            ctx.lineTo(trailPoints[i].x, trailPoints[i].y);
          }
          const grad = ctx.createLinearGradient(
            trailPoints[0].x, trailPoints[0].y,
            trailPoints[trailPoints.length - 1].x, trailPoints[trailPoints.length - 1].y
          );
          grad.addColorStop(0, "rgba(255, 107, 53, 0.05)");
          grad.addColorStop(0.5, "rgba(255, 107, 53, 0.2)");
          grad.addColorStop(1, "rgba(255, 107, 53, 0.5)");
          ctx.strokeStyle = grad;
          ctx.lineWidth = 3;
          ctx.stroke();

          // Area under curve
          ctx.lineTo(trailPoints[trailPoints.length - 1].x, H * 0.85);
          ctx.lineTo(trailPoints[0].x, H * 0.85);
          ctx.closePath();
          const fillGrad = ctx.createLinearGradient(0, H * 0.15, 0, H * 0.85);
          fillGrad.addColorStop(0, "rgba(255, 107, 53, 0.12)");
          fillGrad.addColorStop(1, "rgba(255, 107, 53, 0.01)");
          ctx.fillStyle = fillGrad;
          ctx.fill();
        }

        // Vapor particles
        for (let i = 0; i < 4; i++) {
          const px = curveX - 20 - Math.random() * 25;
          const py = curveY + (Math.random() - 0.5) * 15;
          const size = 1.5 + Math.random() * 2.5;
          ctx.beginPath();
          ctx.arc(px, py, size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 107, 53, ${0.2 + Math.random() * 0.3})`;
          ctx.fill();
        }

        drawJet(ctx, curveX, curveY, angle, 1.3, 0.95);
      }

      if (phase === "cashed_out") {
        const progress = Math.min(1, ((cashoutMultiplier ?? 1) - 1) / 30);
        const endX = W * 0.1 + progress * W * 0.75;
        const endY = H * 0.85 - Math.pow(progress, 0.6) * H * 0.7;

        // Trail remains
        const trailPoints: Array<{ x: number; y: number }> = [];
        for (let p = 0; p <= progress; p += 0.008) {
          trailPoints.push({
            x: W * 0.1 + p * W * 0.75,
            y: H * 0.85 - Math.pow(p, 0.6) * H * 0.7,
          });
        }
        if (trailPoints.length > 1) {
          ctx.beginPath();
          ctx.moveTo(trailPoints[0].x, trailPoints[0].y);
          for (let i = 1; i < trailPoints.length; i++) ctx.lineTo(trailPoints[i].x, trailPoints[i].y);
          ctx.strokeStyle = `rgba(0, 255, 157, 0.4)`;
          ctx.lineWidth = 3;
          ctx.stroke();
        }

        // Success ring
        const ringSize = 20 + Math.sin(t * 3) * 4;
        ctx.beginPath();
        ctx.arc(endX, endY, ringSize, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 255, 157, ${0.4 + 0.2 * Math.sin(t * 4)})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        drawJet(ctx, endX, endY, -30 - progress * 20, 1.2, 0.8);
      }

      if (phase === "crashed") {
        const crashProgress = Math.min(1, ((flyAwayPoint ?? 1) - 1) / 30);
        const crashX = W * 0.1 + crashProgress * W * 0.75;
        const crashY = H * 0.85 - Math.pow(crashProgress, 0.6) * H * 0.7;

        // Faded trail
        const trailPoints: Array<{ x: number; y: number }> = [];
        for (let p = 0; p <= crashProgress; p += 0.008) {
          trailPoints.push({
            x: W * 0.1 + p * W * 0.75,
            y: H * 0.85 - Math.pow(p, 0.6) * H * 0.7,
          });
        }
        if (trailPoints.length > 1) {
          ctx.beginPath();
          ctx.moveTo(trailPoints[0].x, trailPoints[0].y);
          for (let i = 1; i < trailPoints.length; i++) ctx.lineTo(trailPoints[i].x, trailPoints[i].y);
          ctx.strokeStyle = `rgba(255, 68, 68, 0.3)`;
          ctx.lineWidth = 3;
          ctx.stroke();
        }

        // Explosion burst
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2 + t * 0.5;
          const dist = 12 + Math.sin(t * 5 + i) * 8;
          const px = crashX + Math.cos(angle) * dist;
          const py = crashY + Math.sin(angle) * dist;
          ctx.beginPath();
          ctx.arc(px, py, 2 + Math.random() * 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 68, 68, ${0.3 + 0.2 * Math.sin(t * 6 + i)})`;
          ctx.fill();
        }

        // "FLEW AWAY" text
        ctx.fillStyle = LOSE_COLOR;
        ctx.font = "bold 18px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("FLEW AWAY!", W / 2, H * 0.45);
        ctx.font = "bold 28px monospace";
        ctx.fillText(`${(flyAwayPoint ?? 1).toFixed(2)}×`, W / 2, H * 0.55);
      }

      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, multiplier, flyAwayPoint, cashoutMultiplier]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: "14px",
        background: "#08081a",
        border: "1px solid #2a2a50",
      }}
    />
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function AviatorPage() {
  const { user: walletUser } = useWalletUser();
  const { isConnected } = useAccount();
  const session = walletUser ?? (isConnected ? {} : null);

  // Controls
  const [stake, setStake] = useState(100);
  const [autoCashout, setAutoCashout] = useState(0); // 0 = off
  const [customAutoInput, setCustomAutoInput] = useState("");

  // Game state
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [round, setRound] = useState<RoundState | null>(null);
  const [multiplier, setMultiplier] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Balance
  const [balance, setBalance] = useState<number | null>(null);

  // Seeds
  const [seeds, setSeeds] = useState<SeedState | null>(null);

  // Settled round info for display
  const [settled, setSettled] = useState<RoundState | null>(null);

  // Bet history refresh
  const [historyKey, setHistoryKey] = useState(0);

  // Recent fly-away points
  const [recentPoints, setRecentPoints] = useState<number[]>([]);

  // Polling ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const animFrameRef = useRef<number>(0);

  // Fetch balance
  const fetchBalance = useCallback(() => {
    fetch("/api/history")
      .then((r) => r.json())
      .then((d) => {
        if (d.balance != null) setBalance(d.balance);
      })
      .catch(() => {});
  }, []);

  // Fetch seeds
  const fetchSeeds = useCallback(() => {
    fetch("/api/fairness/seeds")
      .then((r) => r.json())
      .then((d) => {
        if (d.serverSeedHash) {
          setSeeds({
            serverSeedHash: d.serverSeedHash,
            clientSeed: d.clientSeed,
            nonce: d.nonce,
          });
        }
      })
      .catch(() => {});
  }, []);

  // Check for active round on mount
  useEffect(() => {
    if (!session) return;
    fetchBalance();
    fetchSeeds();

    fetch("/api/games/aviator/current")
      .then((r) => r.json())
      .then((d) => {
        if (d.round && d.round.status === "FLYING") {
          setRound(d.round);
          setPhase("flying");
          startTimeRef.current = new Date(d.round.startedAt).getTime();
          startPolling(d.round.id);
          startMultiplierAnimation();
        }
      })
      .catch(() => {});

    return () => {
      stopPolling();
      cancelAnimationFrame(animFrameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Multiplier animation (client-side, runs during flight)
  const startMultiplierAnimation = useCallback(() => {
    function tick() {
      if (startTimeRef.current === 0) return;
      const elapsed = Date.now() - startTimeRef.current;
      const m = getMultiplierAtTime(elapsed);
      setMultiplier(m);
      animFrameRef.current = requestAnimationFrame(tick);
    }
    animFrameRef.current = requestAnimationFrame(tick);
  }, []);

  // Poll server for crash / auto-cashout detection
  const startPolling = useCallback((roundId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      fetch("/api/games/aviator/current")
        .then((r) => r.json())
        .then((d) => {
          if (!d.round) {
            // Round gone
            stopPolling();
            return;
          }
          if (d.round.status === "CRASHED") {
            stopPolling();
            cancelAnimationFrame(animFrameRef.current);
            setPhase("crashed");
            setSettled(d.round);
            setRound(null);
            setRecentPoints((prev) => [d.round.flyAwayPoint, ...prev].slice(0, 10));
            fetchBalance();
            fetchSeeds();
            setHistoryKey((k) => k + 1);
          } else if (d.round.status === "CASHED_OUT") {
            stopPolling();
            cancelAnimationFrame(animFrameRef.current);
            setMultiplier(d.round.cashoutMultiplier ?? d.round.currentMultiplier);
            setPhase("cashed_out");
            setSettled(d.round);
            setRound(null);
            setRecentPoints((prev) => [d.round.flyAwayPoint, ...prev].slice(0, 10));
            fetchBalance();
            fetchSeeds();
            setHistoryKey((k) => k + 1);
          }
        })
        .catch(() => {});
    }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // ── Place bet (start round) ───────────────────────────────────────────────
  const handleBet = async () => {
    if (!session) return;
    setError("");
    setLoading(true);
    setSettled(null);

    try {
      const res = await fetch("/api/games/aviator/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stakeGzo: stake,
          ...(autoCashout > 0 ? { autoCashoutAt: autoCashout } : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to start round");
        setLoading(false);
        return;
      }

      setBalance(data.balanceAfter);
      setRound({
        id: data.roundId,
        stakeGzo: data.stakeGzo,
        status: "FLYING",
        startedAt: data.startedAt,
        autoCashoutAt: data.autoCashoutAt,
      });
      setPhase("flying");
      setMultiplier(1.0);
      startTimeRef.current = new Date(data.startedAt).getTime();

      startMultiplierAnimation();
      startPolling(data.roundId);
      fetchSeeds();
    } catch {
      setError("Network error");
    }
    setLoading(false);
  };

  // ── Cash out ──────────────────────────────────────────────────────────────
  const handleCashout = async () => {
    if (!round) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/games/aviator/cashout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: round.id }),
      });
      const data = await res.json();

      stopPolling();
      cancelAnimationFrame(animFrameRef.current);

      if (data.outcome === "CRASHED") {
        setPhase("crashed");
        setSettled({
          ...round,
          status: "CRASHED",
          flyAwayPoint: data.flyAwayPoint,
          cashoutMultiplier: null,
        });
      } else {
        setMultiplier(data.cashoutMultiplier);
        setPhase("cashed_out");
        setSettled({
          ...round,
          status: "CASHED_OUT",
          flyAwayPoint: data.flyAwayPoint,
          cashoutMultiplier: data.cashoutMultiplier,
          grossPayoutGzo: data.grossPayoutGzo,
          profitGzo: data.profitGzo,
          feeGzo: data.feeGzo,
          netPayoutGzo: data.netPayoutGzo,
          balanceAfter: data.balanceAfter,
          serverSeed: data.serverSeed,
          serverSeedHash: data.serverSeedHash,
          clientSeed: data.clientSeed,
          nonce: data.nonce,
        });
      }

      setRecentPoints((prev) => [data.flyAwayPoint, ...prev].slice(0, 10));
      setRound(null);
      fetchBalance();
      fetchSeeds();
      setHistoryKey((k) => k + 1);
    } catch {
      setError("Network error during cashout");
    }
    setLoading(false);
  };

  // ── New round ─────────────────────────────────────────────────────────────
  const handleNewRound = () => {
    setPhase("idle");
    setMultiplier(1.0);
    setSettled(null);
    setError("");
  };

  const isFlying = phase === "flying";
  const canBet = phase === "idle" && !loading && !!session;

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
      {/* ── Recent fly-away strip ──────────────────────────────────────── */}
      {recentPoints.length > 0 && (
        <div style={{
          display: "flex", gap: "0.5rem", marginBottom: "1rem",
          overflowX: "auto", paddingBottom: "0.25rem",
        }}>
          {recentPoints.map((pt, i) => (
            <span
              key={i}
              style={{
                fontSize: "0.72rem", fontWeight: 700, fontFamily: "monospace",
                padding: "0.2rem 0.6rem", borderRadius: "99px",
                background: pt <= 1.5 ? "rgba(255,68,68,0.15)" : pt >= 5 ? "rgba(0,255,157,0.15)" : "rgba(255,107,53,0.15)",
                color: pt <= 1.5 ? LOSE_COLOR : pt >= 5 ? WIN_COLOR : ACCENT,
                flexShrink: 0,
              }}
            >
              {pt.toFixed(2)}×
            </span>
          ))}
        </div>
      )}

      {/* ── 3-column layout ────────────────────────────────────────────── */}
      <div className="game-3col" style={{ marginBottom: "1.5rem" }}>
        {/* ── Left: Controls ─────────────────────────────────────────── */}
        <div className="card" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Stake */}
          <div>
            <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "#555577", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Stake (GZO)
            </label>
            <input
              type="number"
              min={1}
              max={100000}
              value={stake}
              onChange={(e) => setStake(Math.max(1, Math.min(100000, Number(e.target.value))))}
              disabled={isFlying}
              style={{
                width: "100%", padding: "0.5rem", borderRadius: "8px",
                border: "1px solid #2a2a50", background: "#0d0d1a", color: "#f0f0ff",
                fontSize: "1rem", fontWeight: 700, fontFamily: "monospace",
                marginTop: "0.3rem",
              }}
            />
          </div>

          {/* Chips */}
          <div className="chip-row">
            {CHIP_OPTIONS.map((c) => (
              <button
                key={c.value}
                onClick={() => setStake(c.value)}
                disabled={isFlying}
                style={{
                  padding: "0.4rem", borderRadius: "8px",
                  border: stake === c.value ? `2px solid ${c.color}` : "1px solid #2a2a50",
                  background: stake === c.value ? `${c.color}18` : "transparent",
                  color: stake === c.value ? c.color : "#8888aa",
                  fontSize: "0.8rem", fontWeight: 700, cursor: isFlying ? "default" : "pointer",
                }}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Auto cashout */}
          <div>
            <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "#555577", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Auto Cashout
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.3rem" }}>
              {AUTO_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => { setAutoCashout(p.value); setCustomAutoInput(""); }}
                  disabled={isFlying}
                  style={{
                    padding: "0.25rem 0.5rem", borderRadius: "6px",
                    border: autoCashout === p.value && !customAutoInput ? `1px solid ${ACCENT}` : "1px solid #2a2a50",
                    background: autoCashout === p.value && !customAutoInput ? `${ACCENT}18` : "transparent",
                    color: autoCashout === p.value && !customAutoInput ? ACCENT : "#8888aa",
                    fontSize: "0.72rem", fontWeight: 600, cursor: isFlying ? "default" : "pointer",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="number"
              min={1.01}
              max={10000}
              step={0.01}
              placeholder="Custom ×"
              value={customAutoInput}
              onChange={(e) => {
                setCustomAutoInput(e.target.value);
                const v = parseFloat(e.target.value);
                if (v >= 1.01 && v <= 10000) setAutoCashout(v);
                else if (!e.target.value) setAutoCashout(0);
              }}
              disabled={isFlying}
              style={{
                width: "100%", padding: "0.4rem", borderRadius: "6px",
                border: "1px solid #2a2a50", background: "#0d0d1a", color: "#f0f0ff",
                fontSize: "0.8rem", fontFamily: "monospace", marginTop: "0.35rem",
              }}
            />
          </div>

          {/* Action button */}
          {isFlying ? (
            <button
              onClick={handleCashout}
              disabled={loading}
              style={{
                padding: "0.75rem", borderRadius: "10px", border: "none",
                background: `linear-gradient(135deg, ${WIN_COLOR}, #00b878)`,
                color: "#000", fontSize: "1rem", fontWeight: 800,
                cursor: loading ? "wait" : "pointer",
                boxShadow: `0 0 20px rgba(0,255,157,0.3)`,
                animation: "aviator-pulse-btn 1s ease-in-out infinite",
              }}
            >
              {loading ? "..." : `CASH OUT ${multiplier.toFixed(2)}×`}
            </button>
          ) : phase === "cashed_out" || phase === "crashed" ? (
            <button
              onClick={handleNewRound}
              style={{
                padding: "0.75rem", borderRadius: "10px", border: "none",
                background: ACCENT, color: "#fff", fontSize: "1rem", fontWeight: 800,
                cursor: "pointer",
              }}
            >
              New Flight
            </button>
          ) : (
            <button
              onClick={handleBet}
              disabled={!canBet}
              style={{
                padding: "0.75rem", borderRadius: "10px", border: "none",
                background: canBet ? ACCENT : "#333",
                color: canBet ? "#fff" : "#666",
                fontSize: "1rem", fontWeight: 800,
                cursor: canBet ? "pointer" : "default",
              }}
            >
              {loading ? "Starting..." : !session ? "Login to Play" : "Place Bet"}
            </button>
          )}

          {error && (
            <div style={{ fontSize: "0.78rem", color: LOSE_COLOR, textAlign: "center" }}>{error}</div>
          )}

          {balance !== null && (
            <div style={{ fontSize: "0.75rem", color: "#555577", textAlign: "center" }}>
              Balance: <span style={{ color: "#f0f0ff", fontWeight: 700 }}>{balance.toLocaleString()}</span> GZO
            </div>
          )}
        </div>

        {/* ── Center: Canvas + Live Multiplier ───────────────────────── */}
        <div style={{ position: "relative", minHeight: "340px", width: "100%" }}>
          <AviatorCanvas
            phase={phase}
            multiplier={multiplier}
            flyAwayPoint={settled?.flyAwayPoint ?? null}
            cashoutMultiplier={settled?.cashoutMultiplier ?? null}
          />

          {/* Overlay multiplier */}
          {isFlying && (
            <div style={{
              position: "absolute", top: "1.5rem", left: "50%", transform: "translateX(-50%)",
              display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem",
            }}>
              <div style={{
                fontSize: "2.5rem", fontWeight: 900, fontFamily: "monospace",
                color: multiplier >= 3 ? WIN_COLOR : multiplier >= 1.5 ? ACCENT : "#f0f0ff",
                textShadow: `0 0 30px ${multiplier >= 3 ? WIN_COLOR : ACCENT}40`,
                transition: "color 0.3s",
              }}>
                {multiplier.toFixed(2)}×
              </div>
              <div style={{
                fontSize: "0.68rem", fontWeight: 700, color: ACCENT,
                background: `${ACCENT}18`, padding: "0.2rem 0.6rem",
                borderRadius: "99px", textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}>
                Flying
              </div>
            </div>
          )}

          {/* Cashed out overlay */}
          {phase === "cashed_out" && settled && (
            <div style={{
              position: "absolute", top: "1.5rem", left: "50%", transform: "translateX(-50%)",
              textAlign: "center",
            }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, color: WIN_COLOR, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.25rem" }}>
                Cashed Out
              </div>
              <div style={{ fontSize: "2.25rem", fontWeight: 900, fontFamily: "monospace", color: WIN_COLOR }}>
                {(settled.cashoutMultiplier ?? 0).toFixed(2)}×
              </div>
              {settled.netPayoutGzo != null && (
                <div style={{ fontSize: "1rem", fontWeight: 700, color: WIN_COLOR, marginTop: "0.25rem" }}>
                  +{settled.netPayoutGzo.toLocaleString()} GZO
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right: Stats + Fairness ────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {/* Round info */}
          <div className="card" style={{ padding: "1rem" }}>
            <h3 style={{ fontSize: "0.72rem", fontWeight: 700, color: "#555577", textTransform: "uppercase", marginBottom: "0.5rem" }}>
              Round Info
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", fontSize: "0.78rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#8888aa" }}>Status</span>
                <span style={{
                  fontWeight: 700,
                  color: phase === "flying" ? ACCENT : phase === "cashed_out" ? WIN_COLOR : phase === "crashed" ? LOSE_COLOR : "#8888aa",
                }}>
                  {phase === "idle" ? "Waiting" : phase === "flying" ? "In Flight" : phase === "cashed_out" ? "Cashed Out" : "Crashed"}
                </span>
              </div>
              {(round || settled) && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#8888aa" }}>Stake</span>
                    <span style={{ color: "#f0f0ff", fontWeight: 600 }}>{(round?.stakeGzo ?? settled?.stakeGzo ?? 0).toLocaleString()} GZO</span>
                  </div>
                  {isFlying && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#8888aa" }}>Potential</span>
                      <span style={{ color: WIN_COLOR, fontWeight: 700 }}>
                        {Math.floor((round?.stakeGzo ?? 0) * multiplier).toLocaleString()} GZO
                      </span>
                    </div>
                  )}
                  {autoCashout > 0 && isFlying && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#8888aa" }}>Auto @</span>
                      <span style={{ color: ACCENT, fontWeight: 600 }}>{autoCashout.toFixed(2)}×</span>
                    </div>
                  )}
                  {settled?.flyAwayPoint != null && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#8888aa" }}>Flew away @</span>
                      <span style={{ color: LOSE_COLOR, fontWeight: 700 }}>{settled.flyAwayPoint.toFixed(2)}×</span>
                    </div>
                  )}
                  {settled?.cashoutMultiplier != null && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#8888aa" }}>Cashed @</span>
                      <span style={{ color: WIN_COLOR, fontWeight: 700 }}>{settled.cashoutMultiplier.toFixed(2)}×</span>
                    </div>
                  )}
                  {settled?.netPayoutGzo != null && settled.netPayoutGzo > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#8888aa" }}>Payout</span>
                      <span style={{ color: WIN_COLOR, fontWeight: 700 }}>+{settled.netPayoutGzo.toLocaleString()} GZO</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Fairness */}
          {seeds && (
            <FairnessWidget
              serverSeedHash={settled?.serverSeedHash ?? seeds.serverSeedHash}
              clientSeed={seeds.clientSeed}
              nonce={seeds.nonce}
              revealedServerSeed={settled?.serverSeed}
            />
          )}

          {/* How to Play */}
          <div className="card" style={{ padding: "1rem" }}>
            <h3 style={{ fontSize: "0.72rem", fontWeight: 700, color: "#555577", textTransform: "uppercase", marginBottom: "0.5rem" }}>
              How to Play
            </h3>
            <ol style={{ fontSize: "0.75rem", color: "#8888aa", lineHeight: 1.7, margin: 0, paddingLeft: "1.1rem" }}>
              <li>Set your stake and click <strong style={{ color: ACCENT }}>Place Bet</strong></li>
              <li>Watch the multiplier climb in real time</li>
              <li>Click <strong style={{ color: WIN_COLOR }}>Cash Out</strong> anytime to lock in your win</li>
              <li>If the plane flies away before you cash out, you lose your stake</li>
              <li>Set an optional <strong>Auto Cashout</strong> target for hands-free play</li>
            </ol>
          </div>
        </div>
      </div>

      {/* ── Other Games + History ────────────────────────────────────── */}
      <OtherGames exclude="aviator" />

      <div style={{ marginTop: "1.5rem" }}>
        <BetHistory game="AVIATOR" refreshTrigger={historyKey} />
      </div>

      {/* Pulse animation for cashout button */}
      <style>{`
        @keyframes aviator-pulse-btn {
          0%, 100% { box-shadow: 0 0 20px rgba(0,255,157,0.3); }
          50% { box-shadow: 0 0 35px rgba(0,255,157,0.5); }
        }
      `}</style>
    </div>
  );
}
