"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  CoinFlipIcon, DiceIcon, PlinkoIcon,
  KenoIcon, MinesIcon, RouletteIcon, BlackjackIcon, HiloIcon, WheelIcon, AviatorIcon,
} from "./GameIcons";

type GameIconComponent = React.ComponentType<{ size?: number; color: string }>;

const ALL_GAMES: {
  href: string;
  name: string;
  Icon: GameIconComponent;
  desc: string;
  tag: string;
  color: string;
}[] = [
  { href: "/coinflip", name: "Coin Flip", Icon: CoinFlipIcon, desc: "PvP — create a match, opponent joins. Winner takes the pot.",                      tag: "2×",           color: "#00ff9d" },
  { href: "/dice",     name: "Dice",      Icon: DiceIcon,     desc: "Choose a target (1–98), roll under it to win. Instant solo play.",                  tag: "up to 99×",    color: "#00d4ff" },
  { href: "/plinko",   name: "Plinko",    Icon: PlinkoIcon,   desc: "Drop a ball down a peg board and land on a multiplier bin.",                        tag: "up to 1000×",  color: "#ffd700" },
  { href: "/keno",     name: "Keno",      Icon: KenoIcon,     desc: "Pick 1–10 numbers from 40. The RNG draws 10 — get paid by matches.",               tag: "up to 10000×", color: "#a855f7" },
  { href: "/mines",    name: "Mines",     Icon: MinesIcon,    desc: "Reveal safe tiles, grow your multiplier, cash out before hitting a mine.",          tag: "up to 25×",    color: "#ff3d7a" },
  { href: "/roulette", name: "Roulette",  Icon: RouletteIcon, desc: "European roulette — spin the wheel, bet on numbers, colors, and more.",             tag: "up to 36×",    color: "#e879f9" },
  { href: "/blackjack",name: "Blackjack", Icon: BlackjackIcon,desc: "Beat the dealer to 21 — hit, stand, double, or split your hand.",                  tag: "up to 2.5×",   color: "#14b8a6" },
  { href: "/hilo",     name: "Hilo",      Icon: HiloIcon,     desc: "Guess higher, lower, or same — compound your multiplier each round.",              tag: "up to 10000×", color: "#818cf8" },
  { href: "/wheel",    name: "Wheel",     Icon: WheelIcon,    desc: "Spin the provably fair wheel and land on a multiplier segment.",                    tag: "up to 100×",   color: "#fb923c" },
  { href: "/aviator",  name: "Aviator",   Icon: AviatorIcon,  desc: "Set a cashout target — fly higher for bigger wins, but crash and lose it all.",     tag: "up to 10000×", color: "#ff6b35" },
];

// Card width (200px) + gap (16px)
const CARD_STEP = 216;

export default function OtherGames({ exclude }: { exclude: string }) {
  const games = ALL_GAMES.filter((g) => g.href !== `/${exclude}`);
  // Duplicate for seamless infinite loop
  const track = [...games, ...games];

  const [index,     setIndex]     = useState(0);
  const [animating, setAnimating] = useState(true);
  const [paused,    setPaused]    = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setAnimating(true);
      setIndex((prev) => {
        const next = prev + 1;
        // After the transition for the last duplicated frame, snap back silently
        if (next >= games.length) {
          setTimeout(() => {
            setAnimating(false);
            setIndex(0);
          }, 520);
        }
        return next;
      });
    }, 3000);
    return () => clearInterval(id);
  }, [paused, games.length]);

  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "1rem", color: "#f0f0ff" }}>
        Play Another Game
      </h2>
      {/* Viewport — hides overflow, pauses on hover */}
      <div
        style={{ overflow: "hidden", position: "relative" }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* Track — slides left */}
        <div style={{
          display: "flex",
          gap: "1rem",
          transform: `translateX(-${index * CARD_STEP}px)`,
          transition: animating ? "transform 0.5s cubic-bezier(0.4,0,0.2,1)" : "none",
        }}>
          {track.map((game, i) => (
            <Link
              key={`${game.href}-${i}`}
              href={game.href}
              style={{
                flex: "0 0 200px",
                minWidth: "200px",
                background: "#0d0d1a",
                border: `1px solid ${game.color}33`,
                borderRadius: "12px",
                padding: "1.1rem",
                textDecoration: "none",
                display: "block",
                transition: "border-color 0.15s, background 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = game.color;
                (e.currentTarget as HTMLElement).style.background  = `${game.color}0d`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = `${game.color}33`;
                (e.currentTarget as HTMLElement).style.background  = "#0d0d1a";
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                <game.Icon size={36} color={game.color} />
                <span style={{
                  fontSize: "0.62rem", fontWeight: 700, padding: "0.12rem 0.4rem",
                  borderRadius: "99px", background: `${game.color}22`, color: game.color, fontFamily: "monospace",
                }}>
                  {game.tag}
                </span>
              </div>
              <div style={{ fontSize: "0.9rem", fontWeight: 800, color: "#f0f0ff", marginBottom: "0.3rem" }}>{game.name}</div>
              <div style={{ fontSize: "0.72rem", color: "#8888aa", lineHeight: 1.4, marginBottom: "0.7rem" }}>{game.desc}</div>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: game.color }}>Play Now →</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
