"use client";

import Link from "next/link";
import {
  CoinFlipIcon, DiceIcon, PlinkoIcon,
  KenoIcon, MinesIcon, RouletteIcon, BlackjackIcon, HiloIcon, WheelIcon, AviatorIcon,
} from "./GameIcons";

type GameIconComponent = React.ComponentType<{ size?: number; color: string }>;

const GAMES: { href: string; name: string; Icon: GameIconComponent; tag: string; color: string; desc: string }[] = [
  { href: "/coinflip",  name: "Coin Flip", Icon: CoinFlipIcon,  tag: "2×",           color: "#00ff9d", desc: "PvP · Winner takes the pot" },
  { href: "/dice",      name: "Dice",      Icon: DiceIcon,      tag: "up to 99×",    color: "#00d4ff", desc: "Roll under your target" },
  { href: "/plinko",    name: "Plinko",    Icon: PlinkoIcon,    tag: "up to 1000×",  color: "#ffd700", desc: "Drop a ball, hit a bin" },
  { href: "/keno",      name: "Keno",      Icon: KenoIcon,      tag: "up to 10000×", color: "#a855f7", desc: "Pick numbers, get paid" },
  { href: "/mines",     name: "Mines",     Icon: MinesIcon,     tag: "up to 25×",    color: "#ff3d7a", desc: "Reveal gems, avoid bombs" },
  { href: "/roulette",  name: "Roulette",  Icon: RouletteIcon,  tag: "up to 36×",    color: "#e879f9", desc: "Spin the European wheel" },
  { href: "/blackjack", name: "Blackjack", Icon: BlackjackIcon, tag: "up to 2.5×",   color: "#14b8a6", desc: "Beat the dealer to 21" },
  { href: "/hilo",      name: "Hilo",      Icon: HiloIcon,      tag: "up to 10000×", color: "#818cf8", desc: "Higher, lower, or same?" },
  { href: "/wheel",     name: "Wheel",     Icon: WheelIcon,     tag: "up to 100×",   color: "#fb923c", desc: "Spin for a multiplier" },
  { href: "/aviator",   name: "Aviator",   Icon: AviatorIcon,   tag: "up to 10000×", color: "#ff6b35", desc: "Fly before the crash" },
];

export default function HomeGamesGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(210px, 100%), 1fr))", gap: "1rem" }}>
      {GAMES.map(({ href, name, Icon, tag, color, desc }) => (
        <Link
          key={href}
          href={href}
          style={{
            background: "#0d0d1a",
            border: `1px solid ${color}28`,
            borderRadius: "14px",
            padding: "1.25rem",
            textDecoration: "none",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            transition: "border-color 0.15s, background 0.15s, transform 0.15s",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.borderColor = color;
            el.style.background = `${color}0a`;
            el.style.transform = "translateY(-2px)";
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.borderColor = `${color}28`;
            el.style.background = "#0d0d1a";
            el.style.transform = "translateY(0)";
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Icon size={44} color={color} />
            <span style={{
              fontSize: "0.62rem", fontWeight: 700, padding: "0.15rem 0.5rem",
              borderRadius: "99px", background: `${color}20`, color, fontFamily: "monospace",
              flexShrink: 0,
            }}>
              {tag}
            </span>
          </div>
          <div>
            <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: "#f0f0ff", marginBottom: "0.2rem" }}>{name}</div>
            <div style={{ fontSize: "0.75rem", color: "#8888aa" }}>{desc}</div>
          </div>
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color, marginTop: "auto" }}>Play Now →</span>
        </Link>
      ))}
    </div>
  );
}
