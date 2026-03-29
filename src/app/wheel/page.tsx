"use client";

import { useState, useEffect, useRef } from "react";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { parseEther, formatEther } from "viem";
import OtherGames from "@/components/OtherGames";
import NetworkGuard from "@/components/NetworkGuard";
import ApproveGZO from "@/components/ApproveGZO";
import TxStatus, { useTxStatus } from "@/components/TxStatus";
import { useGZOBalance } from "@/lib/web3/hooks/useGZOBalance";
import { useSpinWheel, useWheelRound } from "@/lib/web3/hooks/useWheel";
import { useVRFAutoFulfill } from "@/lib/web3/hooks/useVRFAutoFulfill";
import { ADDRESSES, TREASURY_ABI, GZO_ABI } from "@/lib/web3/contracts";
import { useRecordBet } from "@/lib/web3/hooks/useRecordBet";
import BetHistory from "@/components/BetHistory";
import {
  WHEEL_CONFIGS,
  stopCenterAngle,
  type WheelConfig,
  type WheelRisk,
  type WheelSegment,
} from "@/lib/wheel";
import { SiTarget, SiGear, SiWallet, SiChip, SiSliders, SiRefresh, SiWheel, SiCoins, SiLock, SiDice, SiBarChart, SiZap } from "@/components/GameIcons";

// ── Theme ────────────────────────────────────────────────────────────────────
const ACCENT = "#fb923c";
const GREEN_C = "#00ff9d";
const RED_C   = "#ff5555";

// ── Casino chip config (same values/style as roulette) ───────────────────────
const CHIP_OPTIONS = [
  { value: 10,   color: "#00d4ff", label: "10"   },
  { value: 50,   color: "#00ff9d", label: "50"   },
  { value: 100,  color: "#e879f9", label: "100"  },
  { value: 500,  color: "#ff4444", label: "500"  },
];

// ── Risk mode meta ────────────────────────────────────────────────────────────
const RISK_META: Record<WheelRisk, { color: string; desc: string }> = {
  low:    { color: "#00d4ff", desc: "Safer — smaller prizes, lower variance" },
  medium: { color: ACCENT,    desc: "Balanced — mix of multipliers" },
  high:   { color: RED_C,     desc: "High risk — rare big wins, more zeroes" },
};

// ── SVG Wheel ─────────────────────────────────────────────────────────────────
function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function segmentPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const s = polarToXY(cx, cy, r, startAngle);
  const e = polarToXY(cx, cy, r, endAngle);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)} Z`;
}

function WheelSVG({ config, rotation, transitioning, winningSegIdx, settled }: {
  config: WheelConfig; rotation: number; transitioning: boolean;
  winningSegIdx: number | null; settled: boolean;
}) {
  const SIZE = 320; const cx = SIZE / 2, cy = SIZE / 2, r = SIZE / 2 - 8;
  let cumDeg = 0;
  const segPaths = config.segments.map((seg) => {
    const arcDeg = (seg.weight / config.totalWeight) * 360;
    const startAngle = cumDeg;
    const midAngle = cumDeg + arcDeg / 2;
    const path = segmentPath(cx, cy, r, startAngle, startAngle + arcDeg);
    cumDeg += arcDeg;
    return { seg, path, midAngle, startAngle, arcDeg };
  });

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}
      style={{ transform: `rotate(${rotation}deg)`,
        transition: transitioning ? "transform 5s cubic-bezier(0.17,0.78,0.16,1.0)" : "none",
        display: "block", filter: "drop-shadow(0 0 20px rgba(0,0,0,0.8))" }}>
      <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="#2a2a50" strokeWidth="6" />
      {segPaths.map(({ seg, path, midAngle, arcDeg }) => {
        const isWinner = settled && seg.index === winningSegIdx;
        const lp = polarToXY(cx, cy, r * 0.62, midAngle);
        const showLabel = arcDeg >= 9;
        return (
          <g key={seg.index}>
            <path d={path} fill={isWinner ? seg.textColor + "44" : seg.color}
              stroke="#0d0d1a" strokeWidth="1.5"
              style={{ filter: isWinner ? `drop-shadow(0 0 10px ${seg.textColor})` : "none", transition: "filter 0.3s" }} />
            {showLabel && (
              <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle"
                fill={seg.textColor} fontSize={arcDeg >= 20 ? "13" : "10"} fontWeight="800"
                fontFamily="monospace" transform={`rotate(${midAngle}, ${lp.x}, ${lp.y})`}
                style={{ userSelect: "none", pointerEvents: "none" }}>
                {seg.label}
              </text>
            )}
          </g>
        );
      })}
      {segPaths.map(({ startAngle }, i) => {
        const p = polarToXY(cx, cy, r, startAngle);
        return <line key={i} x1={cx} y1={cy} x2={p.x.toFixed(2)} y2={p.y.toFixed(2)} stroke="#0d0d1a" strokeWidth="2" />;
      })}
      <defs>
        <filter id="centerGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id="centerGrad" cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#fb923c" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0.4" />
        </radialGradient>
      </defs>
      {/* Outer glow ring on center */}
      <circle cx={cx} cy={cy} r={34} fill="none" stroke="#fb923c" strokeWidth="1.5" opacity="0.35" filter="url(#centerGlow)" />
      <circle cx={cx} cy={cy} r={28} fill="#0d0d1a" stroke="#fb923c44" strokeWidth="2" />
      <circle cx={cx} cy={cy} r={18} fill="url(#centerGrad)" opacity="0.85" filter="url(#centerGlow)" />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
        fill="#fb923c" fontSize="15" fontWeight="800" fontFamily="monospace"
        filter="url(#centerGlow)" opacity="0.95">✦</text>
    </svg>
  );
}

// ── Neon Atom Loader (same as roulette) ───────────────────────────────────────
type LoadPhase = "wallet" | "broadcast" | "vrf";
const PHASE_CONFIG: Record<LoadPhase, { title: string; detail: string; colors: [string, string, string] }> = {
  wallet:    { title: "Confirm in Wallet",        detail: "Open MetaMask and approve the transaction to lock your stake on-chain.", colors: [ACCENT, "#00d4ff", "#ffffff"] },
  broadcast: { title: "Broadcasting Transaction", detail: "Your spin is being written to the Polygon blockchain. Awaiting confirmation…", colors: ["#00d4ff", GREEN_C, ACCENT] },
  vrf:       { title: "Awaiting Chainlink VRF",   detail: "A tamper-proof random number is being generated on-chain. This takes ~30–60 seconds.", colors: [GREEN_C, ACCENT, "#00d4ff"] },
};

function AtomLoader({ phase }: { phase: LoadPhase }) {
  const cfg = PHASE_CONFIG[phase];
  const [c0, c1, c2] = cfg.colors;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem", padding: "2rem 1rem" }}>
      <div className="atom-wrap" style={{ position: "relative", width: "130px", height: "130px" }}>
        <div className="nucleus" style={{ position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)", width: "20px", height: "20px", borderRadius: "50%",
          background: `radial-gradient(circle, white 0%, ${c0} 70%)`,
          boxShadow: `0 0 6px white, 0 0 18px ${c0}, 0 0 36px ${c0}88`, zIndex: 10 }} />
        <div className="orbit orbit-0" style={{ position: "absolute", top: "50%", left: "50%",
          width: "120px", height: "50px", marginTop: "-25px", marginLeft: "-60px",
          border: `1.5px solid ${c0}50`, borderRadius: "50%" }}>
          <div style={{ position: "absolute", top: "-5px", left: "calc(50% - 5px)", width: "10px", height: "10px",
            borderRadius: "50%", background: c0, boxShadow: `0 0 8px ${c0}, 0 0 16px ${c0}99` }} />
        </div>
        <div className="orbit orbit-1" style={{ position: "absolute", top: "50%", left: "50%",
          width: "120px", height: "50px", marginTop: "-25px", marginLeft: "-60px",
          border: `1.5px solid ${c1}50`, borderRadius: "50%" }}>
          <div style={{ position: "absolute", top: "-5px", left: "calc(50% - 5px)", width: "10px", height: "10px",
            borderRadius: "50%", background: c1, boxShadow: `0 0 8px ${c1}, 0 0 16px ${c1}99` }} />
        </div>
        <div className="orbit orbit-2" style={{ position: "absolute", top: "50%", left: "50%",
          width: "120px", height: "50px", marginTop: "-25px", marginLeft: "-60px",
          border: `1.5px solid ${c2}40`, borderRadius: "50%" }}>
          <div style={{ position: "absolute", top: "-5px", left: "calc(50% - 5px)", width: "10px", height: "10px",
            borderRadius: "50%", background: c2, boxShadow: `0 0 8px ${c2}, 0 0 16px ${c2}99` }} />
        </div>
        <div style={{ position: "absolute", top: "50%", left: "50%", width: "130px", height: "130px",
          marginTop: "-65px", marginLeft: "-65px", borderRadius: "50%",
          border: `1px solid ${c0}20`, boxShadow: `0 0 30px ${c0}10, inset 0 0 30px ${c0}08`, pointerEvents: "none" }} />
      </div>
      <div style={{ textAlign: "center", maxWidth: "280px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: c0, boxShadow: `0 0 8px ${c0}` }} />
          <span style={{ fontSize: "0.95rem", fontWeight: 800, color: "#f0f0ff" }}>{cfg.title}</span>
        </div>
        <p style={{ fontSize: "0.72rem", color: "#8888aa", lineHeight: 1.6, margin: 0 }}>{cfg.detail}</p>
        <div style={{ display: "flex", justifyContent: "center", gap: "0.3rem", marginTop: "0.875rem" }}>
          {[0,1,2].map(i => <div key={i} className={`prog-dot prog-dot-${i}`} style={{ width: "6px", height: "6px", borderRadius: "50%", background: c0, opacity: 0.3 }} />)}
        </div>
      </div>
    </div>
  );
}

// ── Casino Chip (same as roulette) ────────────────────────────────────────────
function CasinoChip({ value, color, active, onClick }: { value: number; color: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ width: "52px", height: "52px", borderRadius: "50%", cursor: "pointer",
      position: "relative", border: `3px solid ${active ? color : color + "66"}`,
      background: active ? `radial-gradient(circle at 35% 35%, ${color}33 0%, ${color}11 60%, ${color}22 100%)` : `radial-gradient(circle at 35% 35%, ${color}18 0%, #0d0d1a 70%)`,
      boxShadow: active ? `0 0 16px ${color}88, 0 0 32px ${color}44, inset 0 0 12px ${color}22` : `0 0 6px ${color}33, inset 0 0 6px ${color}11`,
      transition: "all 0.15s ease", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1px", outline: "none" }}>
      <div style={{ position: "absolute", inset: "5px", borderRadius: "50%", border: `1px dashed ${color}${active ? "66" : "33"}`, pointerEvents: "none" }} />
      <span style={{ fontSize: value >= 100 ? "0.62rem" : "0.72rem", fontWeight: 900, color: active ? color : color + "cc",
        fontFamily: "monospace", letterSpacing: "-0.03em", lineHeight: 1, position: "relative", zIndex: 1 }}>{value}</span>
      <span style={{ fontSize: "0.45rem", color: active ? color + "cc" : color + "66", fontWeight: 600, position: "relative", zIndex: 1, letterSpacing: "0.04em" }}>GZO</span>
    </button>
  );
}

// ── Right Panel ───────────────────────────────────────────────────────────────
function RightPanel({ config, risk, isSettled, isWaiting, winSeg, multiplierDisplay,
  isWin, resultColor, netPayoutDisplay, stakeNum, activeRoundId }: {
  config: WheelConfig; risk: WheelRisk; isSettled: boolean; isWaiting: boolean;
  winSeg: WheelSegment | null; multiplierDisplay: string; isWin: boolean;
  resultColor: string; netPayoutDisplay: string; stakeNum: number; activeRoundId: `0x${string}` | undefined;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
      {isSettled && winSeg ? (
        <div className="card" style={{ padding: "0.875rem",
          background: isWin ? "rgba(0,255,157,0.04)" : "rgba(255,85,85,0.04)",
          borderColor: isWin ? "rgba(0,255,157,0.25)" : "rgba(255,85,85,0.25)" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: isWin ? GREEN_C : RED_C,
            textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>
            {isWin ? "✓ Result — Win" : "✗ Result — Loss"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <RPRow label="Risk Mode" value={risk.charAt(0).toUpperCase() + risk.slice(1)} />
            <RPRow label="Landed" value={winSeg.label} />
            <RPRow label="Multiplier" value={`${multiplierDisplay}×`} />
            <RPRow label="Stake" value={`${stakeNum} GZO`} />
            <div style={{ borderTop: "1px solid #2a2a50", marginTop: "0.25rem", paddingTop: "0.3rem",
              display: "flex", justifyContent: "space-between", fontSize: "0.82rem", fontWeight: 800,
              color: isWin ? GREEN_C : RED_C }}>
              <span>Net Payout</span><span>{netPayoutDisplay} GZO</span>
            </div>
          </div>
          {activeRoundId && (
            <div style={{ marginTop: "0.5rem", borderTop: "1px solid #2a2a50", paddingTop: "0.5rem" }}>
              <div style={{ fontSize: "0.62rem", color: "#555577", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>Round ID</div>
              <div style={{ fontSize: "0.58rem", fontFamily: "monospace", color: "#8888aa", wordBreak: "break-all", lineHeight: 1.5 }}>{activeRoundId}</div>
            </div>
          )}
        </div>
      ) : (
        /* Payout reference — segments for current risk mode */
        <div className="card" style={{ padding: "0.875rem", background: "#0a0a18", borderColor: "#1a1a35" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f0f0ff",
            textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>
            {risk.charAt(0).toUpperCase() + risk.slice(1)} Mode Segments
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {config.segments.map(seg => {
              const pct = ((seg.weight / config.totalWeight) * 100).toFixed(1);
              return (
                <div key={seg.index} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.72rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: seg.color, border: `1px solid ${seg.textColor}66`, flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, color: seg.textColor, fontFamily: "monospace" }}>{seg.label}</span>
                  </div>
                  <span style={{ color: "#555577", fontSize: "0.65rem" }}>{pct}%</span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: "0.75rem", borderTop: "1px solid #1a1a35", paddingTop: "0.5rem",
            fontSize: "0.65rem", color: "#555577", lineHeight: 1.6 }}>
            10% fee on profit only.<br />Multiplier 0× = full loss of stake.
          </div>
        </div>
      )}

      {/* Provably Fair — always visible */}
      <div className="card" style={{ padding: "0.875rem", background: "#0a0a18", borderColor: "#1a1a35" }}>
        <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f0f0ff",
          textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>
          Provably Fair
        </div>
        {isSettled ? (
          <div style={{ fontSize: "0.7rem", color: "#8888aa", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <div><span style={{ color: "#555577" }}>Landed: </span>
              <span style={{ fontFamily: "monospace", color: resultColor, fontWeight: 700 }}>{winSeg?.label ?? "—"} ({multiplierDisplay}×)</span></div>
            <div><span style={{ color: "#555577" }}>Net payout: </span>
              <span style={{ fontFamily: "monospace", color: isWin ? GREEN_C : RED_C }}>{netPayoutDisplay} GZO</span></div>
            <p style={{ fontSize: "0.65rem", color: "#555577", marginTop: "0.25rem", lineHeight: 1.6 }}>
              Result generated on-chain by Chainlink VRF — fully verifiable, no server involvement.
            </p>
          </div>
        ) : isWaiting ? (
          <div style={{ fontSize: "0.7rem", color: ACCENT, display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <div style={{ width: "10px", height: "10px", border: `2px solid ${ACCENT}`, borderTopColor: "transparent",
              borderRadius: "50%", animation: "vrfSpin 0.8s linear infinite", flexShrink: 0 }} />
            Awaiting Chainlink VRF on-chain…
          </div>
        ) : (
          <div style={{ fontSize: "0.7rem", color: "#555577", lineHeight: 1.6 }}>
            Every spin uses Chainlink VRF on Polygon — a tamper-proof random number generated on-chain. No one, including the house, can predict the landing segment.
          </div>
        )}
      </div>
    </div>
  );
}

function RPRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem" }}>
      <span style={{ color: "#8888aa" }}>{label}</span>
      <span style={{ color: "#f0f0ff", fontFamily: "monospace", textTransform: "capitalize" }}>{value}</span>
    </div>
  );
}

// ── Risk mode map ─────────────────────────────────────────────────────────────
const RISK_MODE_MAP: Record<WheelRisk, 0 | 1 | 2> = { low: 0, medium: 1, high: 2 };

// ── Main Page ─────────────────────────────────────────────────────────────────
function WheelPageInner() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { formatted: balanceFormatted, refetch: refetchBalance } = useGZOBalance();

  const [chipValue,     setChipValue]     = useState(100);
  const [customStake,   setCustomStake]   = useState(100);
  const [risk,          setRisk]          = useState<WheelRisk>("medium");
  const [spinning,      setSpinning]      = useState(false);
  const [rotation,      setRotation]      = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [activeRoundId, setActiveRoundId] = useState<`0x${string}` | undefined>(undefined);
  const [showResult,    setShowResult]    = useState(false);
  const [historyTick,   setHistoryTick]   = useState(0);
  const [spinHint,      setSpinHint]      = useState(false);

  const rotationRef = useRef(0);
  const recordedRef = useRef<string | null>(null);
  const config = WHEEL_CONFIGS[risk];
  const { recordBet } = useRecordBet();

  const { spin, hash, isPending, isConfirming, isSuccess, roundId: newRoundId, error: spinError, reset } = useSpinWheel();
  const { round } = useWheelRound(activeRoundId);

  const stakeWei = chipValue > 0 ? parseEther(String(chipValue)) : BigInt(0);

  const WHEEL_MAX_MULT100: Record<string, number> = { low: 500, medium: 2500, high: 10000 };
  const maxMult100 = WHEEL_MAX_MULT100[risk] ?? 500;
  const maxGrossWei = stakeWei > 0n && maxMult100 > 0 ? (stakeWei * BigInt(maxMult100)) / 100n : 0n;
  const { data: canPayData } = useReadContract({
    address: ADDRESSES.treasuryVault, abi: TREASURY_ABI, functionName: "canPay",
    args: [maxGrossWei], query: { enabled: maxGrossWei > 0n, refetchInterval: 5000 },
  });
  const { data: vaultGzoBalance } = useReadContract({
    address: ADDRESSES.gzoToken, abi: GZO_ABI, functionName: "balanceOf",
    args: [ADDRESSES.treasuryVault], query: { refetchInterval: 5000 },
  });
  const { data: vaultTotalLocked } = useReadContract({
    address: ADDRESSES.treasuryVault, abi: TREASURY_ABI, functionName: "totalLocked",
    query: { refetchInterval: 5000 },
  });
  const solvencyLoading = maxGrossWei > 0n && canPayData === undefined;
  const isSolvent = maxGrossWei === 0n || canPayData === true || solvencyLoading;
  const _vaultBal = typeof vaultGzoBalance === "bigint" ? vaultGzoBalance : 0n;
  const _vaultLocked = typeof vaultTotalLocked === "bigint" ? vaultTotalLocked : 0n;
  const vaultFree = _vaultBal > _vaultLocked ? _vaultBal - _vaultLocked : 0n;
  const maxSafeStakeWei = maxMult100 > 0 && vaultFree > 0n ? (vaultFree * 100n) / BigInt(maxMult100) : 0n;
  const maxSafeStakeGzo = maxSafeStakeWei > 0n ? Math.floor(Number(formatEther(maxSafeStakeWei))) : 0;

  const txStatus = useTxStatus({ isPending, isConfirming, isSuccess: isSuccess && !activeRoundId, error: spinError ?? null });

  useEffect(() => {
    if (isSuccess && newRoundId && !activeRoundId) setActiveRoundId(newRoundId);
  }, [isSuccess, newRoundId, activeRoundId]);

  useEffect(() => {
    if (!round || !(round as any).settled || showResult) return;
    const r = round as any;
    const stopPos = Number(r.stopPosition);
    const centerAngle = stopCenterAngle(stopPos, config.totalWeight);
    const targetOffset = (360 - centerAngle % 360) % 360;
    const extraSpins = 6 * 360;
    const currentRot = rotationRef.current;
    const delta = ((targetOffset - currentRot % 360) + 360) % 360;
    const newRotation = currentRot + delta + extraSpins;
    rotationRef.current = newRotation;
    setTransitioning(true);
    setRotation(newRotation);
    setSpinning(true);

    setTimeout(() => {
      setTransitioning(false);
      setShowResult(true);
      setSpinning(false);
      refetchBalance();
      const rid = activeRoundId;
      if (rid && recordedRef.current !== rid) {
        recordedRef.current = rid;
        recordBet({
          gameType: "WHEEL", onchainRoundId: rid, txHash: hash ?? "",
          stakeGzo: chipValue, netPayoutGzo: Number(formatEther(r.netPayout as bigint)),
          won: Number(r.multiplier100) > 0,
          resultJson: { riskMode: risk, segmentIndex: Number(r.segmentIndex), multiplier100: Number(r.multiplier100) },
          contractAddress: ADDRESSES.wheelGame, chainId,
        }).then(() => setHistoryTick(t => t + 1));
      }
    }, 5400);
  }, [round]); // eslint-disable-line

  const settledRound = round as any;
  const isWaiting = !!(activeRoundId && !settledRound?.settled);
  useVRFAutoFulfill(isWaiting);
  const isSettled = showResult && settledRound?.settled;
  const isBusy = isPending || isConfirming || spinning || isWaiting;
  const canSpin = !!address && chipValue > 0 && !isBusy;

  const multiplier100 = isSettled ? Number(settledRound.multiplier100) : 0;
  const multiplierDisplay = (multiplier100 / 100).toFixed(2).replace(/\.00$/, "");
  const netPayoutWei: bigint = isSettled ? settledRound.netPayout : BigInt(0);
  const netPayoutDisplay = isSettled ? Number(formatEther(netPayoutWei)).toLocaleString(undefined, { maximumFractionDigits: 4 }) : "0";
  const isWin = isSettled && multiplier100 > 0;
  const resultColor = isSettled ? (isWin ? GREEN_C : RED_C) : ACCENT;
  const winningSegIdx: number | null = isSettled ? Number(settledRound.segmentIndex) : null;
  const winSeg = winningSegIdx !== null ? config.segments[winningSegIdx] : null;

  const loadPhase: LoadPhase | null = isPending ? "wallet" : isConfirming ? "broadcast" : (isWaiting && !spinning) ? "vrf" : null;

  function handleSpin() {
    if (!canSpin) { setSpinHint(true); setTimeout(() => setSpinHint(false), 3000); return; }
    reset();
    setShowResult(false);
    setActiveRoundId(undefined);
    setSpinHint(false);
    spin(stakeWei, RISK_MODE_MAP[risk]);
  }

  function handleNewRound() {
    setShowResult(false); setActiveRoundId(undefined); reset(); setSpinHint(false);
  }

  function changeRisk(r: WheelRisk) {
    if (isBusy) return;
    setRisk(r);
    handleNewRound();
  }

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h1 style={{ fontSize: "1.875rem", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: "0.25rem",
          background: `linear-gradient(135deg, ${ACCENT}, #f97316)`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
          Wheel
        </h1>
        <p style={{ color: "#8888aa", fontSize: "0.875rem" }}>Spin the wheel — land on a multiplier segment and win big.</p>
        {address && (
          <p style={{ color: "#555577", fontSize: "0.8rem", marginTop: "0.25rem" }}>
            Balance: <span style={{ color: ACCENT, fontWeight: 700 }}>{balanceFormatted} GZO</span>
          </p>
        )}
      </div>

      {/* 3-col layout */}
      <div className="game-3col">

        {/* LEFT — Controls */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem",
          background: `rgba(251,146,60,0.03)`, borderColor: `rgba(251,146,60,0.2)` }}>

          {/* Casino chips */}
          <div>
            <label style={labelStyle}>Select Chip (GZO)</label>
            <div className="chip-row">
              {CHIP_OPTIONS.map(chip => (
                <CasinoChip key={chip.value} value={chip.value} color={chip.color}
                  active={chipValue === chip.value} onClick={() => { setChipValue(chip.value); setCustomStake(chip.value); }} />
              ))}
            </div>
          </div>

          {/* Custom amount */}
          <div>
            <label style={labelStyle}>Custom Amount</label>
            <input type="number" min={1} max={10000} value={customStake} disabled={isBusy}
              onChange={e => { const v = Math.max(1, parseInt(e.target.value)||1); setCustomStake(v); setChipValue(v); }}
              style={inputStyle} />
          </div>

          {/* Risk mode */}
          <div>
            <label style={labelStyle}>Risk Mode</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {(["low","medium","high"] as WheelRisk[]).map(r => {
                const active = risk === r;
                const { color, desc } = RISK_META[r];
                const maxMult = Math.max(...WHEEL_CONFIGS[r].segments.map(s => s.multiplier));
                return (
                  <button key={r} onClick={() => changeRisk(r)} disabled={isBusy} style={{
                    padding: "0.5rem 0.65rem", borderRadius: "8px",
                    border: `1px solid ${active ? color : "#2a2a50"}`,
                    background: active ? `${color}18` : "transparent",
                    color: active ? color : "#8888aa",
                    fontWeight: active ? 700 : 400, fontSize: "0.78rem",
                    cursor: isBusy ? "not-allowed" : "pointer",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    transition: "all 0.15s", textAlign: "left",
                  }}>
                    <span style={{ textTransform: "capitalize" }}>{r}</span>
                    <span style={{ fontFamily: "monospace", fontSize: "0.68rem", color: active ? color : "#555577" }}>up to {maxMult}×</span>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: "0.65rem", color: "#555577", marginTop: "0.4rem", lineHeight: 1.5 }}>
              {RISK_META[risk].desc}
            </div>
          </div>

          {/* Bet summary */}
          <div style={{ borderTop: "1px solid #2a2a50", paddingTop: "0.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
              <span style={{ color: "#8888aa" }}>Stake</span>
              <span style={{ fontWeight: 700, color: ACCENT }}>{chipValue} GZO</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", marginTop: "0.2rem" }}>
              <span style={{ color: "#555577" }}>Max win</span>
              <span style={{ color: "#8888aa", fontFamily: "monospace" }}>
                {(chipValue * Math.max(...config.segments.map(s => s.multiplier))).toLocaleString()} GZO
              </span>
            </div>
          </div>

          {txStatus !== "idle" && <TxStatus status={txStatus} hash={hash} error={spinError ?? null} compact />}

          {/* Spin button */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {isSettled ? (
              <button onClick={handleNewRound} style={{ padding: "0.75rem", borderRadius: "8px",
                border: `1px solid ${ACCENT}44`, background: `${ACCENT}0a`, color: ACCENT,
                fontSize: "0.9375rem", cursor: "pointer", fontWeight: 700 }}>
                New Spin
              </button>
            ) : (
              <>
                {!isSolvent && !isBusy && chipValue > 0 && (
                  <div style={{
                    padding: "0.5rem 0.6rem", borderRadius: "7px",
                    background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.35)",
                    fontSize: "0.68rem", color: "#fb923c", lineHeight: 1.5,
                  }}>
                    <strong>House bankroll too low</strong> for this bet.<br />
                    {maxSafeStakeGzo > 0 ? `Max safe stake: ${maxSafeStakeGzo} GZO per bet` : "Reduce your stake."}
                    {maxSafeStakeGzo > 0 && (
                      <button
                        onClick={() => { setCustomStake(maxSafeStakeGzo); setChipValue(maxSafeStakeGzo); }}
                        style={{ display: "block", marginTop: "0.3rem", background: "rgba(251,146,60,0.15)",
                          border: "1px solid rgba(251,146,60,0.4)", borderRadius: "5px", color: "#fb923c",
                          fontSize: "0.65rem", padding: "0.2rem 0.5rem", cursor: "pointer", fontWeight: 700 }}
                      >
                        Use {maxSafeStakeGzo} GZO
                      </button>
                    )}
                  </div>
                )}
                <ApproveGZO spender={ADDRESSES.treasuryVault} requiredAmount={stakeWei}>
                <div style={{ position: "relative" }}>
                  <button onClick={handleSpin} disabled={isBusy || !isSolvent}
                    className={canSpin ? "spin-btn-active-wheel" : ""}
                    style={{
                      background: canSpin ? `linear-gradient(135deg, ${ACCENT}, #f97316)` : "#2a2a50",
                      border: canSpin ? `1px solid ${ACCENT}66` : "1px solid #3a3a60",
                      borderRadius: "8px", color: canSpin ? "#0a0a18" : "#666688",
                      fontWeight: 800, fontSize: "0.9375rem", padding: "0.75rem",
                      cursor: isBusy ? "not-allowed" : "pointer", opacity: isBusy ? 0.5 : 1,
                      width: "100%", transition: "all 0.2s ease",
                      boxShadow: canSpin ? `0 0 24px ${ACCENT}55, 0 0 48px ${ACCENT}22` : "none",
                    }}>
                    {isPending ? "Confirm in wallet…" : isConfirming ? "Broadcasting…" : isWaiting ? "Awaiting VRF…" : spinning ? "Spinning…" : "Spin"}
                  </button>
                  {spinHint && (
                    <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%",
                      transform: "translateX(-50%)", background: "#1a1a35", border: `1px solid ${ACCENT}44`,
                      borderRadius: "8px", padding: "0.4rem 0.75rem", fontSize: "0.72rem", color: ACCENT,
                      whiteSpace: "nowrap", boxShadow: "0 4px 16px rgba(0,0,0,0.5)", animation: "fadeIn 0.2s ease" }}>
                      Set a stake amount to spin
                    </div>
                  )}
                </div>
              </ApproveGZO>
              </>
            )}
          </div>
        </div>

        {/* CENTER — Wheel */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="card" style={{ padding: "1.5rem", background: `rgba(251,146,60,0.02)`,
            borderColor: `rgba(251,146,60,0.2)`, display: "flex", flexDirection: "column",
            alignItems: "center", gap: "1.25rem", position: "relative", minHeight: "420px" }}>

            {/* Atom loader overlay */}
            {loadPhase && (
              <div style={{ position: "absolute", inset: 0, borderRadius: "inherit",
                background: "rgba(10,10,24,0.92)", display: "flex", alignItems: "center",
                justifyContent: "center", zIndex: 20, backdropFilter: "blur(4px)" }}>
                <AtomLoader phase={loadPhase} />
              </div>
            )}

            {/* Pointer + Wheel */}
            <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {/* Orange pointer triangle at top */}
              <div style={{ position: "absolute", top: -14, left: "50%", transform: "translateX(-50%)",
                width: 0, height: 0,
                borderLeft: "11px solid transparent", borderRight: "11px solid transparent",
                borderTop: `18px solid ${ACCENT}`, zIndex: 10,
                filter: `drop-shadow(0 0 6px ${ACCENT}aa)` }} />

              {/* Idle glow ring — pulsing accent ring when not spinning or settled */}
              {!isSettled && !spinning && (
                <div className="wheel-idle-glow" style={{
                  position: "absolute", width: 336, height: 336, borderRadius: "50%",
                  border: `2px solid ${ACCENT}55`,
                  boxShadow: `0 0 28px ${ACCENT}33, 0 0 56px ${ACCENT}18`,
                  pointerEvents: "none",
                }} />
              )}

              {/* Glow ring when settled */}
              {isSettled && (
                <div style={{ position: "absolute", width: 340, height: 340, borderRadius: "50%",
                  border: `3px solid ${resultColor}`, boxShadow: `0 0 30px ${resultColor}44`,
                  animation: "pulse 1.5s ease infinite", pointerEvents: "none" }} />
              )}

              <WheelSVG config={config} rotation={rotation} transitioning={transitioning}
                winningSegIdx={winningSegIdx} settled={isSettled} />
            </div>

            {/* Result / status text */}
            {isSettled ? (
              <div style={{ textAlign: "center", animation: "slideUp 0.4s ease" }}>
                <div style={{ fontSize: "2.5rem", fontWeight: 900, fontFamily: "monospace",
                  color: resultColor, animation: "resultGlow 2s ease-in-out infinite" }}>
                  {multiplierDisplay}×
                </div>
                <div style={{ fontSize: "1rem", fontWeight: 700, color: resultColor, marginTop: "0.25rem" }}>
                  {isWin ? "Winner!" : "Better luck next time"}
                </div>
                {isWin && (
                  <div style={{ fontSize: "0.85rem", color: "#8888aa", marginTop: "0.25rem" }}>
                    +{netPayoutDisplay} GZO net payout
                  </div>
                )}
              </div>
            ) : !loadPhase && (
              <div style={{ textAlign: "center", color: "#555577", fontSize: "0.875rem" }}>
                {spinning ? <span style={{ color: ACCENT, fontWeight: 700 }}>Spinning…</span> : "Place your bet and spin"}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — always visible panel */}
        <RightPanel config={config} risk={risk} isSettled={isSettled} isWaiting={isWaiting}
          winSeg={winSeg} multiplierDisplay={multiplierDisplay} isWin={isWin}
          resultColor={resultColor} netPayoutDisplay={netPayoutDisplay}
          stakeNum={chipValue} activeRoundId={activeRoundId} />
      </div>

      {/* ── How to Play ──────────────────────────────────────────────────── */}
      <div className="card" style={{ background: "rgba(0,212,255,0.03)", borderColor: "rgba(0,212,255,0.2)",
        marginBottom: "1.25rem", padding: "1.25rem" }}>
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "1rem", color: "#00d4ff",
          display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <SiTarget size={16} color="#00d4ff" /> How to Play
        </h2>
        <div className="howto-grid">
          {[
            { step:"1", title:"Connect Wallet",     desc:"Connect MetaMask on Polygon Amoy. You need GZO tokens to play.", icon: <SiWallet size={14} color="#00d4ff" /> },
            { step:"2", title:"Pick a Chip Value",  desc:"Select your bet amount — 10, 50, 100, or 500 GZO. Or enter a custom amount.", icon: <SiChip size={14} color="#00d4ff" /> },
            { step:"3", title:"Choose Risk Mode",   desc:"Low gives smaller but more frequent wins. High gives rare but massive multipliers (up to 100×). Medium is balanced.", icon: <SiSliders size={14} color="#00d4ff" /> },
            { step:"4", title:"Hit Spin",           desc:"Confirm in MetaMask. Your stake locks on-chain while Chainlink VRF generates the provably fair landing segment.", icon: <SiRefresh size={14} color="#00d4ff" /> },
            { step:"5", title:"Watch the Wheel",   desc:"The wheel spins and lands on a segment. Each segment shows its multiplier. Larger segments appear more often.", icon: <SiWheel size={14} color="#00d4ff" /> },
            { step:"6", title:"Collect Winnings",  desc:"Your payout = stake × multiplier. If you land on 0×, the stake goes to the house. Winnings transfer to your wallet instantly.", icon: <SiCoins size={14} color="#00d4ff" /> },
          ].map(item => (
            <div key={item.step} style={{ background: "rgba(0,212,255,0.04)", border: "1px solid rgba(0,212,255,0.12)",
              borderRadius: "10px", padding: "0.875rem", display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
              <div style={{ flexShrink: 0, width: "28px", height: "28px", borderRadius: "50%",
                background: "rgba(0,212,255,0.15)", border: "1px solid rgba(0,212,255,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.7rem", fontWeight: 800, color: "#00d4ff" }}>{item.step}</div>
              <div>
                <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#f0f0ff", marginBottom: "0.2rem" }}>{item.icon} {item.title}</div>
                <div style={{ fontSize: "0.7rem", color: "#8888aa", lineHeight: 1.5 }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Play Another Game ─────────────────────────────────────────────── */}
      <OtherGames exclude="wheel" />

      {/* ── How It Works ──────────────────────────────────────────────────── */}
      <div className="card" style={{ background: `rgba(251,146,60,0.02)`, borderColor: `rgba(251,146,60,0.15)`,
        marginBottom: "1.25rem", padding: "1.25rem" }}>
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "1rem", color: ACCENT,
          display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <SiGear size={16} color={ACCENT} /> How It Works
        </h2>
        <div className="stat-grid-2">
          {[
            { icon: <SiLock size={20} color={ACCENT} />, title:"Stake Locking", desc:"When you spin, your GZO stake is transferred into the TreasuryVault smart contract and locked on-chain for the round duration. No funds leave the blockchain." },
            { icon: <SiDice size={20} color={ACCENT} />, title:"Chainlink VRF Stop Position", desc:"The WheelGame contract calls RandomnessCoordinator, which requests a random number from Chainlink VRF. This number maps to a stop position [0, totalWeight). The result is cryptographically provable and manipulation-proof." },
            { icon: <SiBarChart size={20} color={ACCENT} />, title:"Segment Resolution", desc:"The wheel has 54 total weight units. Each segment occupies a share of that weight. The VRF stop position falls within exactly one segment, determining the multiplier. Larger segments (0×) appear more often." },
            { icon: <SiZap size={20} color={ACCENT} />, title:"Payout & Settlement", desc:"Win payout = stake × multiplier, minus 10% fee on profit only. E.g., 100 GZO stake × 5× = 500 GZO gross → 460 GZO net (40 GZO fee on 400 GZO profit). A 0× result means your stake is absorbed by the vault as bankroll." },
          ].map(item => (
            <div key={item.title} style={{ background: `rgba(251,146,60,0.03)`, border: `1px solid rgba(251,146,60,0.1)`,
              borderRadius: "10px", padding: "0.875rem" }}>
              <div style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>{item.icon}</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 700, color: ACCENT, marginBottom: "0.3rem" }}>{item.title}</div>
              <div style={{ fontSize: "0.7rem", color: "#8888aa", lineHeight: 1.6 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── History ───────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.875rem", color: "#8888aa" }}>Your History</h2>
        <BetHistory game="WHEEL" refreshTrigger={historyTick} />
      </div>

      <style>{`
        @keyframes slideUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes resultGlow { 0%,100%{text-shadow:0 0 8px currentColor} 50%{text-shadow:0 0 28px currentColor,0 0 48px currentColor} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes vrfSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes fadeIn { from{opacity:0;transform:translateX(-50%) translateY(4px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes nucleusPulse { 0%,100%{transform:translate(-50%,-50%) scale(1)} 50%{transform:translate(-50%,-50%) scale(1.25)} }
        @keyframes orbitSpin0 { from{transform:rotateZ(0deg) rotateX(15deg)} to{transform:rotateZ(360deg) rotateX(15deg)} }
        @keyframes orbitSpin1 { from{transform:rotateZ(0deg) rotateX(75deg) rotateZ(60deg)} to{transform:rotateZ(360deg) rotateX(75deg) rotateZ(60deg)} }
        @keyframes orbitSpin2 { from{transform:rotateZ(120deg) rotateX(45deg) rotateZ(0deg)} to{transform:rotateZ(120deg) rotateX(45deg) rotateZ(360deg)} }
        @keyframes progDot { 0%,80%,100%{opacity:.25;transform:scale(1)} 40%{opacity:1;transform:scale(1.4)} }
        @keyframes spinBtnGlowWheel { 0%,100%{box-shadow:0 0 20px #fb923c55,0 0 40px #fb923c22} 50%{box-shadow:0 0 32px #fb923c88,0 0 64px #fb923c44} }
        @keyframes wheelIdleGlow { 0%,100%{box-shadow:0 0 20px #fb923c22,0 0 44px #fb923c10;border-color:#fb923c33} 50%{box-shadow:0 0 40px #fb923c55,0 0 80px #fb923c22;border-color:#fb923c88} }
        .spin-btn-active-wheel { animation: spinBtnGlowWheel 2s ease-in-out infinite !important; }
        .wheel-idle-glow { animation: wheelIdleGlow 2.4s ease-in-out infinite; }
        .atom-wrap { perspective: 400px; }
        .nucleus { animation: nucleusPulse 1.8s ease-in-out infinite; }
        .orbit-0 { animation: orbitSpin0 2.2s linear infinite; }
        .orbit-1 { animation: orbitSpin1 1.7s linear infinite; }
        .orbit-2 { animation: orbitSpin2 3.1s linear infinite; }
        .prog-dot-0 { animation: progDot 1.4s ease-in-out 0s infinite; }
        .prog-dot-1 { animation: progDot 1.4s ease-in-out 0.2s infinite; }
        .prog-dot-2 { animation: progDot 1.4s ease-in-out 0.4s infinite; }
      `}</style>
    </div>
  );
}

export default function WheelPage() {
  return <NetworkGuard><WheelPageInner /></NetworkGuard>;
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.68rem", fontWeight: 700,
  color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.35rem",
};
const inputStyle: React.CSSProperties = {
  width: "100%", background: "#0d0d1a", border: "1px solid #2a2a50",
  borderRadius: "8px", padding: "0.5rem 0.6rem", color: "#f0f0ff",
  fontSize: "0.9375rem", fontWeight: 700, outline: "none", boxSizing: "border-box",
};
