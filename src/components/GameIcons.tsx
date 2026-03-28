"use client";

type P = { size?: number; color: string };

// ── Coin Flip — gold coin with star emblem ────────────────────────────────────
export function CoinFlipIcon({ size = 40, color }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="21" fill={`${color}12`} stroke={color} strokeWidth="2.5" />
      <circle cx="24" cy="24" r="15" fill={`${color}08`} stroke={`${color}40`} strokeWidth="1" />
      {/* 5-point star */}
      <path
        d="M24 11 L26.9 19.5 L35.9 19.8 L29.1 25.2 L31.4 34.2 L24 29.5 L16.6 34.2 L18.9 25.2 L12.1 19.8 L21.1 19.5 Z"
        fill={color}
      />
    </svg>
  );
}

// ── Dice — classic die with 5 dots ────────────────────────────────────────────
export function DiceIcon({ size = 40, color }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <rect x="5" y="5" width="38" height="38" rx="9" fill={`${color}12`} stroke={color} strokeWidth="2.5" />
      <circle cx="15" cy="15" r="3.5" fill={color} />
      <circle cx="33" cy="15" r="3.5" fill={color} />
      <circle cx="24" cy="24" r="3.5" fill={color} />
      <circle cx="15" cy="33" r="3.5" fill={color} />
      <circle cx="33" cy="33" r="3.5" fill={color} />
    </svg>
  );
}

// ── Plinko — ball dropping through peg pyramid into bins ─────────────────────
export function PlinkoIcon({ size = 40, color }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* Ball */}
      <circle cx="24" cy="6" r="4.5" fill={color} />
      <circle cx="22.5" cy="4.5" r="1.5" fill={`${color}80`} />
      {/* Drop line */}
      <line x1="24" y1="10" x2="24" y2="18" stroke={`${color}40`} strokeWidth="1" strokeDasharray="2 2" />
      {/* Row 1 — 2 pegs */}
      <circle cx="17" cy="21" r="3" fill={`${color}80`} />
      <circle cx="31" cy="21" r="3" fill={`${color}80`} />
      {/* Row 2 — 3 pegs */}
      <circle cx="10" cy="32" r="2.5" fill={`${color}55`} />
      <circle cx="24" cy="32" r="2.5" fill={`${color}55`} />
      <circle cx="38" cy="32" r="2.5" fill={`${color}55`} />
      {/* Bins */}
      <rect x="3"  y="39" width="9"  height="6" rx="1.5" fill={`${color}15`} stroke={`${color}40`} strokeWidth="1" />
      <rect x="14" y="39" width="9"  height="6" rx="1.5" fill={`${color}40`} stroke={color}        strokeWidth="1.5" />
      <rect x="26" y="39" width="9"  height="6" rx="1.5" fill={`${color}15`} stroke={`${color}40`} strokeWidth="1" />
      <rect x="37" y="39" width="8"  height="6" rx="1.5" fill={`${color}08`} stroke={`${color}25`} strokeWidth="1" />
    </svg>
  );
}

// ── Keno — lottery balls grid ─────────────────────────────────────────────────
export function KenoIcon({ size = 40, color }: P) {
  const positions = [
    { cx: 11, cy: 14, hi: false },
    { cx: 24, cy: 14, hi: true  },
    { cx: 37, cy: 14, hi: false },
    { cx: 11, cy: 34, hi: false },
    { cx: 24, cy: 34, hi: true  },
    { cx: 37, cy: 34, hi: false },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {positions.map((p, i) => (
        <g key={i}>
          <circle cx={p.cx} cy={p.cy} r="9"
            fill={p.hi ? `${color}28` : `${color}10`}
            stroke={color} strokeWidth={p.hi ? 2 : 1.5}
          />
          {/* Shine highlight */}
          <circle cx={p.cx - 3} cy={p.cy - 3} r={p.hi ? 3 : 2.5}
            fill={p.hi ? `${color}70` : `${color}30`}
          />
        </g>
      ))}
    </svg>
  );
}

// ── Mines — grid of tiles with diamond gem and hidden mine ────────────────────
export function MinesIcon({ size = 40, color }: P) {
  const CELL = 13; const GAP = 1.5; const S = 3.5;
  const cells: { row: number; col: number }[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push({ row: r, col: c });

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {cells.map(({ row, col }) => {
        const x  = S + col * (CELL + GAP);
        const y  = S + row * (CELL + GAP);
        const cx = x + CELL / 2;
        const cy = y + CELL / 2;
        const isGem  = col === 1 && row === 1;
        const isMine = col === 2 && row === 0;
        return (
          <g key={`${col}-${row}`}>
            <rect x={x} y={y} width={CELL} height={CELL} rx="2.5"
              fill={isGem ? `${color}22` : isMine ? "rgba(255,80,80,0.1)" : `${color}08`}
              stroke={isGem ? color : isMine ? "#ff5555" : `${color}30`}
              strokeWidth={isGem ? 1.5 : 1}
            />
            {isGem && (
              <path
                d={`M ${cx} ${y + 2} L ${x + CELL - 2} ${cy} L ${cx} ${y + CELL - 2} L ${x + 2} ${cy} Z`}
                fill={color}
              />
            )}
            {isMine && (
              <path
                d={`M ${x + 3} ${y + 3} L ${x + CELL - 3} ${y + CELL - 3} M ${x + CELL - 3} ${y + 3} L ${x + 3} ${y + CELL - 3}`}
                stroke="#ff5555" strokeWidth="2" strokeLinecap="round"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Roulette — wheel with alternating red/black segments ──────────────────────
export function RouletteIcon({ size = 40, color }: P) {
  const CX = 24, CY = 24, R = 20;
  const n = 12;
  const step = 360 / n;

  function pt(deg: number) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: +(CX + R * Math.cos(rad)).toFixed(3), y: +(CY + R * Math.sin(rad)).toFixed(3) };
  }

  const fills = Array.from({ length: n }, (_, i) =>
    i === 0 ? "rgba(0,195,90,0.85)" : i % 2 === 1 ? "#1a1a35" : color
  );

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx={CX} cy={CY} r={R + 1.5} fill={`${color}15`} stroke={color} strokeWidth="2" />
      {fills.map((fill, i) => {
        const s = pt(i * step);
        const e = pt((i + 1) * step);
        return (
          <path key={i}
            d={`M ${CX} ${CY} L ${s.x} ${s.y} A ${R} ${R} 0 0 1 ${e.x} ${e.y} Z`}
            fill={fill} stroke="#08081a" strokeWidth="0.8"
          />
        );
      })}
      {/* Inner hub */}
      <circle cx={CX} cy={CY} r="8"  fill="#08081a" stroke={color} strokeWidth="1.5" />
      <circle cx={CX} cy={CY} r="4"  fill={`${color}35`} />
      <circle cx={CX} cy={CY} r="2"  fill={color} />
      {/* Ball */}
      <circle cx={CX} cy={CY - R + 4} r="2.5" fill="#ffffff" stroke="#cccccc" strokeWidth="0.5" />
    </svg>
  );
}

// ── Blackjack — two overlapping playing cards, Ace of Spades on top ───────────
export function BlackjackIcon({ size = 40, color }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* Back card */}
      <rect x="6" y="11" width="26" height="34" rx="4" fill="#12122a" stroke={`${color}45`} strokeWidth="1.5" />
      <rect x="9" y="14" width="20" height="28" rx="2" fill={`${color}10`} stroke={`${color}20`} strokeWidth="0.5" />
      {/* Front card (white) */}
      <rect x="16" y="3" width="26" height="34" rx="4" fill="#f4f4ff" stroke={color} strokeWidth="2" />
      {/* Spade suit — path */}
      <path
        d="M29 16 C29 16 23 22 23 26 C23 28.5 25.5 29.5 29 27 C29 30 27.5 32 26 33 L32 33 C30.5 32 29 30 29 27 C32.5 29.5 35 28.5 35 26 C35 22 29 16 29 16Z"
        fill="#1a1a2e"
      />
      {/* "A" — top left corner */}
      <text x="19" y="15" fontSize="9" fontWeight="900" fill="#1a1a2e" fontFamily="Georgia,serif">A</text>
      {/* Small spade below A */}
      <text x="19.5" y="24" fontSize="7" fill="#1a1a2e" fontFamily="serif">♠</text>
    </svg>
  );
}

// ── Hilo — playing card flanked by up/down arrows ─────────────────────────────
export function HiloIcon({ size = 40, color }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* Up arrow — left */}
      <path d="M8 34 L8 14 M8 14 L4 20 M8 14 L12 20"
        stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Card */}
      <rect x="14" y="6" width="20" height="28" rx="3.5" fill="#f4f4ff" stroke={color} strokeWidth="2" />
      {/* Question mark on card */}
      <text x="24" y="27" fontSize="15" fontWeight="900" fill="#1a1a2e"
        fontFamily="Georgia,serif" textAnchor="middle">?</text>
      {/* Down arrow — right */}
      <path d="M40 14 L40 34 M40 34 L36 28 M40 34 L44 28"
        stroke={`${color}65`} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Next card peek at bottom */}
      <rect x="15" y="36" width="18" height="8" rx="2" fill={`${color}18`} stroke={`${color}50`} strokeWidth="1" />
    </svg>
  );
}

// ── Aviator — ascending jet with altitude trail ─────────────────────────────
export function AviatorIcon({ size = 40, color }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* Altitude trail — ascending dots */}
      <circle cx="8"  cy="40" r="1.5" fill={`${color}20`} />
      <circle cx="12" cy="36" r="1.5" fill={`${color}35`} />
      <circle cx="16" cy="31" r="1.5" fill={`${color}50`} />
      {/* Ascending curve (flight path) */}
      <path
        d="M 6 42 Q 18 30 26 20 Q 32 13 42 6"
        stroke={`${color}40`} strokeWidth="1.5" strokeDasharray="3 3"
        fill="none" strokeLinecap="round"
      />
      {/* Jet body — sleek forward shape */}
      <path
        d="M 34 14 L 44 6 L 42 16 L 34 14 Z"
        fill={color} stroke={color} strokeWidth="1" strokeLinejoin="round"
      />
      {/* Wing */}
      <path d="M 36 15 L 26 22 L 34 17 Z" fill={`${color}80`} />
      {/* Tail fin */}
      <path d="M 38 18 L 32 24 L 37 20 Z" fill={`${color}60`} />
      {/* Engine glow */}
      <circle cx="33" cy="16" r="3" fill={`${color}25`} />
      <circle cx="33" cy="16" r="1.5" fill={`${color}60`} />
      {/* Multiplier indicator lines */}
      <line x1="3" y1="44" x2="12" y2="44" stroke={`${color}25`} strokeWidth="1" />
      <line x1="3" y1="38" x2="8"  y2="38" stroke={`${color}35`} strokeWidth="1" />
      <line x1="3" y1="32" x2="5"  y2="32" stroke={`${color}50`} strokeWidth="1" />
    </svg>
  );
}

// ── How-to-Play / How-It-Works section icons ──────────────────────────────────
// These are stroke-based (Lucide style) icons used in the informational sections
// of every game page — replacing emoji for a premium look.

type SI = { size?: number; color?: string };
const si = (size: number, color: string) => ({
  width: size, height: size, viewBox: "0 0 24 24" as const,
  fill: "none" as const, stroke: color, strokeWidth: 2 as const,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  style: { flexShrink: 0, display: "inline-block", verticalAlign: "middle" },
});

/** 🎯  "How to Play" section header — bullseye / target */
export function SiTarget({ size = 16, color = "currentColor" }: SI) {
  return <svg {...si(size, color)}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>;
}

/** ⚙️  "How It Works" section header — settings cog */
export function SiGear({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

/** 🔗  Connect Wallet — card / wallet */
export function SiWallet({ size = 16, color = "currentColor" }: SI) {
  return <svg {...si(size, color)}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M16 14h.01" strokeWidth={3}/></svg>;
}

/** 🪙  Pick a Chip / Stake — coin stack */
export function SiChip({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <ellipse cx="12" cy="8" rx="8" ry="3"/>
      <path d="M4 8v4c0 1.66 3.58 3 8 3s8-1.34 8-3V8"/>
      <path d="M4 12v4c0 1.66 3.58 3 8 3s8-1.34 8-3v-4"/>
    </svg>
  );
}

/** ⚖️  Risk / Rows — sliders */
export function SiSliders({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
      <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
      <line x1="2" y1="14" x2="6" y2="14"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="18" y1="16" x2="22" y2="16"/>
    </svg>
  );
}

/** 🌀  Hit Spin — rotate arrow */
export function SiRefresh({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
      <path d="M21 3v5h-5"/>
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
      <path d="M3 21v-5h5"/>
    </svg>
  );
}

/** 🎡  Watch the Wheel — wheel/circle spokes */
export function SiWheel({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.64 5.64l2.83 2.83M15.54 15.54l2.83 2.83M18.36 5.64l-2.83 2.83M8.46 15.54l-2.83 2.83"/>
      <circle cx="12" cy="12" r="2" fill={color} stroke="none"/>
    </svg>
  );
}

/** 💰  Collect Winnings — coins */
export function SiCoins({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <circle cx="8" cy="8" r="6"/>
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18"/>
      <path d="M7 6h1v4"/>
      <line x1="16.71" y1="13.88" x2="13.14" y2="17.42"/>
    </svg>
  );
}

/** 🎰  Place Your Bets — stacked cards */
export function SiCards({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <rect x="2" y="5" width="13" height="16" rx="2"/>
      <rect x="9" y="3" width="13" height="16" rx="2"/>
    </svg>
  );
}

/** 🔢  Select Numbers — grid */
export function SiGrid({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
    </svg>
  );
}

/** ✨  Watch the Reveal — eye */
export function SiEye({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

/** 🃏  Deal a Card — single card */
export function SiCard({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <rect x="4" y="2" width="16" height="20" rx="2"/>
      <path d="M8 7h1M8 11h5M8 15h3"/>
    </svg>
  );
}

/** 🔮  Make Your Guess (Hi-Lo) — up/down arrows */
export function SiArrowUpDown({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <path d="M8 3l4-4 4 4" transform="translate(0 4)"/>
      <path d="M16 21l-4 4-4-4" transform="translate(0 -4)"/>
      <line x1="12" y1="3" x2="12" y2="21"/>
    </svg>
  );
}

/** 📈  Build Multiplier — trending up */
export function SiTrendingUp({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
      <polyline points="16 7 22 7 22 13"/>
    </svg>
  );
}

/** ⬇️  Watch It Bounce (Plinko) — arrow down */
export function SiArrowDown({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <line x1="12" y1="5" x2="12" y2="19"/>
      <polyline points="19 12 12 19 5 12"/>
    </svg>
  );
}

/** 🎯  Drop the Ball — ball with trail */
export function SiDropBall({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <circle cx="12" cy="7" r="4"/>
      <path d="M12 11v6"/>
      <path d="M8 17l4 4 4-4"/>
    </svg>
  );
}

/** Deal Cards action (Blackjack step 3) */
export function SiDealCards({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <rect x="2" y="5" width="13" height="17" rx="2"/>
      <rect x="9" y="2" width="13" height="17" rx="2"/>
    </svg>
  );
}

/** Hit or Stand — hand */
export function SiHand({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <path d="M18 11V6a2 2 0 0 0-4 0v5"/>
      <path d="M14 10V4a2 2 0 0 0-4 0v6"/>
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8"/>
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
    </svg>
  );
}

/** Double / Split */
export function SiSplit({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <path d="M16 3h5v5"/><path d="M8 3H3v5"/>
      <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/>
      <path d="M12 22v-8.3a4 4 0 0 1 1.172-2.872L21 3"/>
    </svg>
  );
}

/** Auto-settle */
export function SiCheckCircle({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
  );
}

/** Reveal Tiles (Mines step) */
export function SiGrid4({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  );
}

/** Cash Out — arrow with circle */
export function SiCashOut({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <circle cx="12" cy="12" r="10"/>
      <path d="M8 12h8M13 8l4 4-4 4"/>
    </svg>
  );
}

// ── Info card icons (rendered at ~20px above card titles) ────────────────────

/** 🔐  On-Chain Stake Locking — padlock */
export function SiLock({ size = 20, color = "currentColor" }: SI) {
  return <svg {...si(size, color)}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
}

/** 🎲  Chainlink VRF — dice */
export function SiDice({ size = 20, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <rect x="2" y="2" width="20" height="20" rx="3"/>
      <circle cx="8"  cy="8"  r="1.5" fill={color} stroke="none"/>
      <circle cx="16" cy="8"  r="1.5" fill={color} stroke="none"/>
      <circle cx="8"  cy="16" r="1.5" fill={color} stroke="none"/>
      <circle cx="16" cy="16" r="1.5" fill={color} stroke="none"/>
      <circle cx="12" cy="12" r="1.5" fill={color} stroke="none"/>
    </svg>
  );
}

/** 📊  Evaluation / Segment resolution — bar chart */
export function SiBarChart({ size = 20, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6"  y1="20" x2="6"  y2="14"/>
      <line x1="2"  y1="20" x2="22" y2="20"/>
    </svg>
  );
}

/** 💸  Payout & Settlement — lightning bolt */
export function SiZap({ size = 20, color = "currentColor" }: SI) {
  return <svg {...si(size, color)}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
}

/** 🔀  Fisher-Yates Shuffle — shuffle arrows */
export function SiShuffle({ size = 20, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <polyline points="16 3 21 3 21 8"/>
      <line x1="4" y1="20" x2="21" y2="3"/>
      <polyline points="21 16 21 21 16 21"/>
      <line x1="15" y1="15" x2="21" y2="21"/>
      <line x1="4" y1="4" x2="9" y2="9"/>
    </svg>
  );
}

/** 📐  Probability / Multiplier Math — function / math */
export function SiFunction({ size = 20, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <path d="M12 20a8 8 0 0 1-8-8 8 8 0 0 1 8-8 8 8 0 0 1 8 8"/>
      <path d="M12 4v8l4 4"/>
    </svg>
  );
}

/** ✅  On-Chain Verification — shield check */
export function SiShieldCheck({ size = 20, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      <path d="m9 12 2 2 4-4"/>
    </svg>
  );
}

/** 🔗  VRF Deck Commitment — chain link */
export function SiLink({ size = 20, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  );
}

/** ⛓️  Player Actions On-Chain — chain */
export function SiChain({ size = 20, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <path d="M9 17H7A5 5 0 0 1 7 7h2"/>
      <path d="M15 7h2a5 5 0 1 1 0 10h-2"/>
      <line x1="8" y1="12" x2="16" y2="12"/>
    </svg>
  );
}

/** Multi-Bet Evaluation — layers */
export function SiLayers({ size = 20, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <polygon points="12 2 2 7 12 12 22 7 12 2"/>
      <polyline points="2 17 12 22 22 17"/>
      <polyline points="2 12 12 17 22 12"/>
    </svg>
  );
}

/** 🏆  Blackjack! / Win — trophy */
export function SiTrophy({ size = 16, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
      <path d="M4 22h16"/>
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>
    </svg>
  );
}

/** 💎  Safe tile (Mines) — gem */
export function SiGem({ size = 18, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <polyline points="6 3 2 8 12 22 22 8 18 3"/>
      <line x1="2" y1="8" x2="22" y2="8"/>
      <line x1="12" y1="22" x2="6" y2="3"/>
      <line x1="12" y1="22" x2="18" y2="3"/>
    </svg>
  );
}

/** 💣  Mine tile — bomb */
export function SiBomb({ size = 18, color = "currentColor" }: SI) {
  return (
    <svg {...si(size, color)}>
      <circle cx="11" cy="13" r="7"/>
      <path d="M14.35 4.65L16 3"/>
      <path d="M16 3l1.5 1.5"/>
      <line x1="8"  y1="9"  x2="8.5"  y2="8.5"/>
      <line x1="8"  y1="17" x2="7.5"  y2="17.5"/>
      <line x1="14" y1="17" x2="14.5" y2="17.5"/>
    </svg>
  );
}

// ── Wheel — fortune wheel with segments and pointer ───────────────────────────
export function WheelIcon({ size = 40, color }: P) {
  const CX = 24, CY = 27, R = 18;
  const n = 8;
  const step = 360 / n;
  const opacities = [1, 0.12, 0.65, 0.12, 0.45, 0.12, 0.65, 0.12];

  function pt(deg: number) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: +(CX + R * Math.cos(rad)).toFixed(3), y: +(CY + R * Math.sin(rad)).toFixed(3) };
  }

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* Pointer triangle */}
      <path d={`M ${CX - 5} 2 L ${CX + 5} 2 L ${CX} 10 Z`} fill={color} />
      {/* Segments */}
      {opacities.map((op, i) => {
        const s = pt(i * step);
        const e = pt((i + 1) * step);
        return (
          <path key={i}
            d={`M ${CX} ${CY} L ${s.x} ${s.y} A ${R} ${R} 0 0 1 ${e.x} ${e.y} Z`}
            fill={color} fillOpacity={op}
            stroke="#08081a" strokeWidth="0.6"
          />
        );
      })}
      {/* Rim */}
      <circle cx={CX} cy={CY} r={R} fill="none" stroke={color} strokeWidth="2" />
      {/* Hub */}
      <circle cx={CX} cy={CY} r="5.5" fill="#08081a" stroke={color} strokeWidth="1.5" />
      <circle cx={CX} cy={CY} r="2.5" fill={color} />
    </svg>
  );
}
