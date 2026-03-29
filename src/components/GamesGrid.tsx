"use client";

import Link from "next/link";
import {
  CoinFlipIcon, DiceIcon, PlinkoIcon,
  KenoIcon, MinesIcon, RouletteIcon, BlackjackIcon, HiloIcon, WheelIcon, AviatorIcon,
} from "./GameIcons";

type GameIconComponent = React.ComponentType<{ size?: number; color: string }>;

const GAMES: {
  href: string;
  name: string;
  Icon: GameIconComponent;
  desc: string;
  tag: string;
  color: string;
  badge?: string;
}[] = [
  { href: "/coinflip",  name: "Coin Flip",  Icon: CoinFlipIcon,  desc: "PvP — create a match, opponent joins. Winner takes the pot.",            tag: "2×",        color: "#00ff9d", badge: "PvP" },
  { href: "/dice",      name: "Dice",        Icon: DiceIcon,      desc: "Choose a target (1–98), roll under it to win. Instant solo play.",       tag: "up to 99×", color: "#00d4ff" },
  { href: "/plinko",    name: "Plinko",      Icon: PlinkoIcon,    desc: "Drop a ball down a peg board and land on a multiplier bin.",             tag: "up to 1000×",color: "#ffd700" },
  { href: "/mines",     name: "Mines",       Icon: MinesIcon,     desc: "Reveal safe tiles, grow your multiplier, cash out before a mine.",       tag: "up to 25×", color: "#ff3d7a" },
  { href: "/keno",      name: "Keno",        Icon: KenoIcon,      desc: "Pick 1–10 numbers from 40. Match drawn numbers to win.",                 tag: "up to 10000×",color: "#a855f7" },
  { href: "/roulette",  name: "Roulette",    Icon: RouletteIcon,  desc: "European roulette — spin the wheel, bet on numbers and colors.",         tag: "up to 36×", color: "#e879f9" },
  { href: "/blackjack", name: "Blackjack",   Icon: BlackjackIcon, desc: "Beat the dealer to 21 — hit, stand, double, or split your hand.",       tag: "up to 2.5×",color: "#14b8a6" },
  { href: "/hilo",      name: "Hilo",        Icon: HiloIcon,      desc: "Guess higher or lower — compound your multiplier with each card.",       tag: "up to 10000×",color: "#818cf8" },
  { href: "/wheel",     name: "Wheel",       Icon: WheelIcon,     desc: "Spin the provably fair wheel and land on a multiplier segment.",         tag: "up to 100×",color: "#fb923c" },
  { href: "/aviator",   name: "Aviator",     Icon: AviatorIcon,   desc: "Set a cashout target — fly higher for bigger wins, but crash and lose it all.", tag: "up to 10000×",color: "#ff6b35" },
];

export default function GamesGrid() {
  return (
    <div style={{ marginBottom: "2.5rem" }}>
      <h2 style={{
        fontSize: "0.75rem",
        fontWeight: 700,
        marginBottom: "1rem",
        color: "#555577",
        textTransform: "uppercase",
        letterSpacing: "0.1em",
      }}>
        Choose a Game
      </h2>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(min(220px, 100%), 1fr))",
        gap: "0.875rem",
      }}>
        {GAMES.map((game) => (
          <Link
            key={game.href}
            href={game.href}
            style={{
              background: "#0d0d1a",
              border: `1px solid ${game.color}28`,
              borderRadius: "14px",
              padding: "1.25rem",
              textDecoration: "none",
              display: "flex",
              flexDirection: "column",
              gap: "0",
              transition: "border-color 0.15s, background 0.15s, transform 0.15s, box-shadow 0.15s",
              position: "relative",
              overflow: "hidden",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = `${game.color}70`;
              el.style.background = `${game.color}0a`;
              el.style.transform = "translateY(-2px)";
              el.style.boxShadow = `0 8px 30px ${game.color}18`;
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = `${game.color}28`;
              el.style.background = "#0d0d1a";
              el.style.transform = "translateY(0)";
              el.style.boxShadow = "none";
            }}
          >
            {/* Top row: icon + tag */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "0.875rem" }}>
              <game.Icon size={40} color={game.color} />
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.3rem" }}>
                <span style={{
                  fontSize: "0.68rem",
                  fontWeight: 700,
                  padding: "0.2rem 0.55rem",
                  borderRadius: "99px",
                  background: `${game.color}20`,
                  color: game.color,
                  fontFamily: "monospace",
                  whiteSpace: "nowrap",
                }}>
                  {game.tag}
                </span>
                {game.badge && (
                  <span style={{
                    fontSize: "0.6rem",
                    fontWeight: 700,
                    padding: "0.15rem 0.45rem",
                    borderRadius: "99px",
                    background: "rgba(0,255,157,0.12)",
                    color: "#00ff9d",
                    border: "1px solid rgba(0,255,157,0.25)",
                    letterSpacing: "0.05em",
                  }}>
                    {game.badge}
                  </span>
                )}
              </div>
            </div>

            {/* Name */}
            <div style={{ fontSize: "1rem", fontWeight: 800, color: "#f0f0ff", marginBottom: "0.375rem", letterSpacing: "-0.25px" }}>
              {game.name}
            </div>

            {/* Description */}
            <div style={{ fontSize: "0.775rem", color: "#666688", lineHeight: 1.55, marginBottom: "1rem", flexGrow: 1 }}>
              {game.desc}
            </div>

            {/* CTA */}
            <span style={{
              fontSize: "0.8rem",
              fontWeight: 700,
              color: game.color,
              display: "flex",
              alignItems: "center",
              gap: "0.3rem",
            }}>
              Play Now
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6h8M6 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>

            {/* Subtle glow strip at top */}
            <div style={{
              position: "absolute",
              top: 0,
              left: "20%",
              right: "20%",
              height: "1px",
              background: `linear-gradient(90deg, transparent, ${game.color}50, transparent)`,
            }} />
          </Link>
        ))}
      </div>
    </div>
  );
}
