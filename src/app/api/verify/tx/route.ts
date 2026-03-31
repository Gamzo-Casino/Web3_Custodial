import { NextRequest, NextResponse } from "next/server";
import { getPublicClient } from "@/lib/viemServer";
import { decodeEventLog, formatEther } from "viem";
import {
  DICE_GAME_ABI,
  PLINKO_GAME_ABI,
  ROULETTE_GAME_ABI,
  MINES_GAME_ABI,
  BLACKJACK_GAME_ABI,
  HILO_GAME_ABI,
  KENO_GAME_ABI,
  ERC20_TRANSFER_ABI,
} from "@/lib/viemServer";
import { ADDRESSES } from "@/lib/web3/contracts";

export const dynamic = "force-dynamic";

// ── ABI fragments ──────────────────────────────────────────────────────────────

// RandomnessCoordinator — s_requests(vrfRequestId) public mapping
const COORDINATOR_ABI = [
  {
    name: "s_requests",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "vrfRequestId", type: "uint256" }],
    outputs: [
      { name: "fulfilled",  type: "bool"    },
      { name: "exists",     type: "bool"    },
      { name: "randomWord", type: "uint256" },
    ],
  },
  {
    name: "RandomnessRequested",
    type: "event",
    inputs: [
      { name: "vrfRequestId",  type: "uint256", indexed: true },
      { name: "gameId",        type: "bytes32", indexed: true },
      { name: "roundId",       type: "bytes32", indexed: true },
    ],
  },
  {
    name: "RandomnessFulfilled",
    type: "event",
    inputs: [
      { name: "vrfRequestId",  type: "uint256", indexed: true  },
      { name: "gameId",        type: "bytes32", indexed: true  },
      { name: "roundId",       type: "bytes32", indexed: true  },
      { name: "randomWord",    type: "uint256", indexed: false },
    ],
  },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────────

function getGameRegistry() {
  return [
    { name: "Dice",      address: ADDRESSES.diceGame?.toLowerCase(),      abi: DICE_GAME_ABI,      getRoundAbi: DICE_GAME_ABI      },
    { name: "Plinko",    address: ADDRESSES.plinkoGame?.toLowerCase(),     abi: PLINKO_GAME_ABI,    getRoundAbi: PLINKO_GAME_ABI    },
    { name: "Roulette",  address: ADDRESSES.rouletteGame?.toLowerCase(),   abi: ROULETTE_GAME_ABI,  getRoundAbi: ROULETTE_GAME_ABI  },
    { name: "Mines",     address: ADDRESSES.minesGame?.toLowerCase(),      abi: MINES_GAME_ABI,     getRoundAbi: MINES_GAME_ABI     },
    { name: "Blackjack", address: ADDRESSES.blackjackGame?.toLowerCase(),  abi: BLACKJACK_GAME_ABI, getRoundAbi: BLACKJACK_GAME_ABI },
    { name: "Hilo",      address: ADDRESSES.hiloGame?.toLowerCase(),       abi: HILO_GAME_ABI,      getRoundAbi: HILO_GAME_ABI      },
    { name: "Keno",      address: ADDRESSES.kenoGame?.toLowerCase(),       abi: KENO_GAME_ABI,      getRoundAbi: KENO_GAME_ABI      },
  ];
}

function formatGzo(wei: bigint): string {
  return `${Number(formatEther(wei)).toLocaleString("en-US", { maximumFractionDigits: 4 })} GZO`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeLog(log: any, abi: readonly any[], gameName: string): Record<string, unknown> | null {
  try {
    const decoded   = decodeEventLog({ abi, data: log.data, topics: log.topics });
    const args      = decoded.args as unknown as Record<string, unknown>;
    const eventName = decoded.eventName as unknown as string;

    const fields: Record<string, string> = {};

    if (args.roundId) fields["Round ID"] = String(args.roundId);
    if (args.player)  fields["Player"]   = String(args.player);
    if (args.stake)   fields["Stake"]    = formatGzo(args.stake as bigint);

    switch (eventName) {
      case "BetPlaced":
        if (args.targetScaled !== undefined) fields["Target"]      = `${(Number(args.targetScaled) / 100).toFixed(2)}`;
        if (args.rows         !== undefined) fields["Rows"]        = String(args.rows);
        if (args.risk         !== undefined) fields["Risk"]        = ["Low", "Medium", "High"][Number(args.risk)] ?? String(args.risk);
        if (args.picks        !== undefined) fields["Picks"]       = (args.picks as number[]).join(", ");
        if (args.wagerCount   !== undefined) fields["Wager Count"] = String(args.wagerCount);
        break;

      case "RoundSettled":
        if (args.roll         !== undefined) fields["Roll"]          = `${(Number(args.roll) / 100).toFixed(2)}`;
        if (args.won          !== undefined) fields["Result"]        = args.won ? "✓ WIN" : "✗ LOSS";
        if (args.netPayout    !== undefined) fields["Net Payout"]    = formatGzo(args.netPayout as bigint);
        if (args.fee          !== undefined) fields["Fee"]           = formatGzo(args.fee as bigint);
        if (args.pathBits     !== undefined) fields["Path Bits"]     = `0x${(args.pathBits as bigint).toString(16)}`;
        if (args.binIndex     !== undefined) fields["Bin Index"]     = String(args.binIndex);
        if (args.multiplier100 !== undefined) fields["Multiplier"]  = `${(Number(args.multiplier100) / 100).toFixed(2)}×`;
        if (args.drawn        !== undefined) fields["Drawn Numbers"] = (args.drawn as number[]).join(", ");
        if (args.matchCount   !== undefined) fields["Matches"]      = String(args.matchCount);
        break;

      case "SpinPlaced":
        if (args.totalStake !== undefined) fields["Total Stake"] = formatGzo(args.totalStake as bigint);
        if (args.wagerCount !== undefined) fields["Wager Count"] = String(args.wagerCount);
        break;

      case "SpinSettled":
        if (args.winningNumber !== undefined) fields["Winning Number"] = String(args.winningNumber);
        if (args.totalGross    !== undefined) fields["Gross Payout"]   = formatGzo(args.totalGross as bigint);
        if (args.netPayout     !== undefined) fields["Net Payout"]     = formatGzo(args.netPayout as bigint);
        if (args.fee           !== undefined) fields["Fee"]            = formatGzo(args.fee as bigint);
        break;

      case "RoundStarted":
        if (args.mineCount    !== undefined) fields["Mine Count"]  = String(args.mineCount);
        if (args.vrfRequestId !== undefined) fields["VRF Request"] = String(args.vrfRequestId);
        break;

      case "RoundCashedOut":
        if (args.safePicks     !== undefined) fields["Safe Tiles"]  = String(args.safePicks);
        if (args.multiplier100 !== undefined) fields["Multiplier"]  = `${(Number(args.multiplier100) / 100).toFixed(2)}×`;
        if (args.netPayout     !== undefined) fields["Net Payout"]  = formatGzo(args.netPayout as bigint);
        if (args.fee           !== undefined) fields["Fee"]         = formatGzo(args.fee as bigint);
        break;

      case "RoundLost":
        if (args.hitTile   !== undefined) fields["Hit Tile"]  = String(args.hitTile);
        if (args.stepIndex !== undefined) fields["Lost Step"] = String(args.stepIndex);
        break;

      case "RoundActive":
        if (args.deckSeed !== undefined) fields["Deck Seed"] = `0x${(args.deckSeed as bigint).toString(16)}`;
        break;
    }

    return { game: gameName, event: eventName, logIndex: log.logIndex, address: log.address, fields,
      _raw: { roundId: args.roundId, vrfRequestId: args.vrfRequestId } };
  } catch {
    return null;
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const txHash = searchParams.get("hash")?.trim();

  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({ error: "Invalid transaction hash" }, { status: 400 });
  }

  try {
    const client   = getPublicClient();
    const registry = getGameRegistry();

    // Fetch receipt + tx in parallel
    const [receipt, tx] = await Promise.all([
      client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
      client.getTransaction({ hash: txHash as `0x${string}` }),
    ]);

    if (!receipt) return NextResponse.json({ error: "Transaction not found on Polygon Amoy" }, { status: 404 });

    const status  = receipt.status === "success" ? "Success" : "Failed";
    const block   = receipt.blockNumber.toString();
    const gasUsed = receipt.gasUsed.toString();

    // ── Decode logs ──────────────────────────────────────────────────────────
    const events:    ReturnType<typeof decodeLog>[]                   = [];
    const transfers: { from: string; to: string; amount: string }[]   = [];
    let   detectedGame: (typeof registry)[0] | null                   = null;

    // Also scan for coordinator events in this tx
    let coordinatorRequested: { vrfRequestId: bigint; roundId: string } | null = null;
    let coordinatorFulfilled: { vrfRequestId: bigint; randomWord: bigint } | null = null;

    for (const log of receipt.logs) {
      const addrLower = log.address.toLowerCase();

      // ERC-20 Transfer
      if (addrLower === ADDRESSES.gzoToken?.toLowerCase()) {
        try {
          const decoded = decodeEventLog({ abi: ERC20_TRANSFER_ABI, data: log.data, topics: log.topics });
          if (decoded.eventName === "Transfer") {
            const args = decoded.args as { from: string; to: string; value: bigint };
            transfers.push({ from: args.from, to: args.to, amount: formatGzo(args.value) });
          }
        } catch { /* not a Transfer */ }
        continue;
      }

      // RandomnessCoordinator events
      if (addrLower === ADDRESSES.randomnessCoordinator?.toLowerCase()) {
        try {
          const decoded = decodeEventLog({ abi: COORDINATOR_ABI, data: log.data, topics: log.topics });
          const args = decoded.args as unknown as Record<string, unknown>;
          if (decoded.eventName === "RandomnessRequested") {
            coordinatorRequested = {
              vrfRequestId: args.vrfRequestId as bigint,
              roundId:      String(args.roundId),
            };
          } else if (decoded.eventName === "RandomnessFulfilled") {
            coordinatorFulfilled = {
              vrfRequestId: args.vrfRequestId as bigint,
              randomWord:   args.randomWord as bigint,
            };
          }
        } catch { /* not a coordinator event */ }
        continue;
      }

      // Game contracts
      const game = registry.find(g => g.address && addrLower === g.address);
      if (game) {
        if (!detectedGame) detectedGame = game;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const decoded = decodeLog(log, game.abi as any, game.name);
        if (decoded) events.push(decoded);
      }
    }

    // ── VRF data — read from chain ───────────────────────────────────────────
    // Collect roundId and vrfRequestId from decoded events
    let roundId:      string | null = null;
    let vrfRequestId: bigint | null = null;

    for (const ev of events) {
      if (!ev) continue;
      const raw = ev._raw as Record<string, unknown>;
      if (raw.roundId      && !roundId)      roundId      = String(raw.roundId);
      if (raw.vrfRequestId && !vrfRequestId) vrfRequestId = BigInt(String(raw.vrfRequestId));
    }
    // Also from coordinator event if not in game events
    if (!vrfRequestId && coordinatorRequested) vrfRequestId = coordinatorRequested.vrfRequestId;
    if (!roundId      && coordinatorRequested) roundId      = coordinatorRequested.roundId;

    // Fetch from coordinator + game contract in parallel (best-effort)
    type VrfData = {
      vrfRequestId:    string;
      randomWord:      string | null;
      fulfilled:       boolean;
      randomWordHex:   string | null;
      // Derived — how the random word maps to the game result
      derivedInfo:     string | null;
    } | null;

    let vrfData: VrfData = null;
    let roundData: Record<string, string> | null = null;

    const coordinatorAddr = ADDRESSES.randomnessCoordinator as `0x${string}` | undefined;

    await Promise.all([
      // 1. Read s_requests from coordinator
      (async () => {
        if (!vrfRequestId || !coordinatorAddr) return;
        try {
          const result = await client.readContract({
            address: coordinatorAddr,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            abi:     COORDINATOR_ABI as any,
            functionName: "s_requests",
            args: [vrfRequestId],
          }) as [boolean, boolean, bigint];

          const [fulfilled, exists, randomWord] = result;
          if (!exists) return;

          const rwHex = `0x${randomWord.toString(16).padStart(64, "0")}`;
          // Derived info: show modulo used for game result
          let derivedInfo: string | null = null;
          if (fulfilled && detectedGame) {
            if (detectedGame.name === "Dice") {
              const roll = Number(randomWord % 10000n) / 100;
              derivedInfo = `randomWord % 10000 = ${Number(randomWord % 10000n)} → Roll ${roll.toFixed(2)}`;
            } else if (detectedGame.name === "Roulette") {
              const num = Number(randomWord % 37n);
              derivedInfo = `randomWord % 37 = ${num} → Winning Number ${num}`;
            } else if (detectedGame.name === "Keno") {
              derivedInfo = `randomWord used to draw 10 numbers from 1–40 via Fisher-Yates shuffle`;
            } else if (detectedGame.name === "Plinko") {
              derivedInfo = `randomWord bits determine ball path (L/R per row)`;
            } else if (detectedGame.name === "Mines") {
              derivedInfo = `randomWord used to shuffle mine positions on a 5×5 grid`;
            } else if (detectedGame.name === "Blackjack" || detectedGame.name === "Hilo") {
              derivedInfo = `randomWord used as deck seed to shuffle 52-card deck`;
            }
          }

          vrfData = {
            vrfRequestId: vrfRequestId.toString(),
            randomWord:   fulfilled ? randomWord.toString() : null,
            fulfilled,
            randomWordHex: fulfilled ? rwHex : null,
            derivedInfo,
          };
        } catch { /* coordinator not deployed or call failed */ }
      })(),

      // 2. Read getRound from game contract
      (async () => {
        if (!roundId || !detectedGame) return;
        try {
          const gameAddr = (
            detectedGame.name === "Dice"      ? ADDRESSES.diceGame :
            detectedGame.name === "Plinko"    ? ADDRESSES.plinkoGame :
            detectedGame.name === "Roulette"  ? ADDRESSES.rouletteGame :
            detectedGame.name === "Mines"     ? ADDRESSES.minesGame :
            detectedGame.name === "Blackjack" ? ADDRESSES.blackjackGame :
            detectedGame.name === "Hilo"      ? ADDRESSES.hiloGame :
            detectedGame.name === "Keno"      ? ADDRESSES.kenoGame : null
          ) as `0x${string}` | null;

          if (!gameAddr) return;

          const round = await client.readContract({
            address: gameAddr,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            abi:     detectedGame.getRoundAbi as any,
            functionName: "getRound",
            args: [roundId as `0x${string}`],
          }) as Record<string, unknown>;

          const r: Record<string, string> = {};

          if (round.player)       r["Player"]       = String(round.player);
          if (round.stake)        r["Stake"]         = formatGzo(round.stake as bigint);
          if (round.settled !== undefined || round.status !== undefined) {
            const statusMap: Record<number, string> = { 0: "Pending", 1: "Active", 2: "Cashed Out / Settled", 3: "Lost", 4: "Refunded" };
            r["Status"] = round.settled !== undefined
              ? (round.settled ? "Settled" : "Pending")
              : (statusMap[Number(round.status)] ?? String(round.status));
          }
          if (round.netPayout)    r["Net Payout"]    = formatGzo(round.netPayout as bigint);
          if (round.vrfSeed && (round.vrfSeed as bigint) > 0n)
                                  r["VRF Seed"]      = `0x${(round.vrfSeed as bigint).toString(16).padStart(64, "0")}`;
          if (round.deckSeed && (round.deckSeed as bigint) > 0n)
                                  r["Deck Seed"]     = `0x${(round.deckSeed as bigint).toString(16).padStart(64, "0")}`;
          if (round.vrfRequestId) r["VRF Request ID"] = String(round.vrfRequestId);
          if (round.createdAt)    r["Created At"]    = new Date(Number(round.createdAt) * 1000).toUTCString();
          if (round.settledAt && (round.settledAt as bigint) > 0n)
                                  r["Settled At"]    = new Date(Number(round.settledAt) * 1000).toUTCString();
          // Game-specific
          if (round.targetScaled) r["Target"]        = `${(Number(round.targetScaled) / 100).toFixed(2)}`;
          if (round.roll)         r["Roll"]          = `${(Number(round.roll) / 100).toFixed(2)}`;
          if (round.won !== undefined) r["Won"]      = String(round.won);
          if (round.mineCount)    r["Mine Count"]    = String(round.mineCount);
          if (round.safePicks)    r["Safe Picks"]    = String(round.safePicks);
          if (round.multiplier100 && (round.multiplier100 as bigint) > 0n)
                                  r["Multiplier"]    = `${(Number(round.multiplier100 as bigint) / 100).toFixed(2)}×`;
          if (round.matchCount)   r["Match Count"]   = String(round.matchCount);
          if (round.winningNumber !== undefined) r["Winning Number"] = String(round.winningNumber);
          if (round.pathBits && (round.pathBits as bigint) > 0n)
                                  r["Path Bits"]     = `0x${(round.pathBits as bigint).toString(16)}`;
          if (round.binIndex !== undefined) r["Bin Index"] = String(round.binIndex);
          if (round.rows)         r["Rows"]          = String(round.rows);
          if (round.risk !== undefined) r["Risk"]    = ["Low", "Medium", "High"][Number(round.risk)] ?? String(round.risk);
          if (Array.isArray(round.picks)) r["Picks"] = (round.picks as number[]).join(", ");
          if (Array.isArray(round.drawn)) r["Drawn"] = (round.drawn as number[]).filter((n: number) => n > 0).join(", ");

          if (Object.keys(r).length > 0) roundData = r;
        } catch { /* round not found or not supported */ }
      })(),
    ]);

    // ── Build summary ────────────────────────────────────────────────────────
    const gameName = detectedGame?.name ?? "Unknown";

    const placedEvent  = events.find(e => ["BetPlaced", "SpinPlaced", "RoundStarted"].includes(e?.event as string));
    const settledEvent = events.find(e => ["RoundSettled", "SpinSettled", "RoundCashedOut", "RoundLost"].includes(e?.event as string));

    let outcome   = "Pending";
    let netPayout = "—";

    if (settledEvent) {
      const f = settledEvent.fields as Record<string, string>;
      if (settledEvent.event === "RoundLost")    outcome = "Lost";
      else if (f["Result"])                      outcome = f["Result"];
      else if (f["Net Payout"])                  outcome = "Won";
      netPayout = f["Net Payout"] ?? roundData?.["Net Payout"] ?? "—";
    }

    // Remove _raw from response
    const cleanEvents = events.map(e => e ? { game: e.game, event: e.event, logIndex: e.logIndex, address: e.address, fields: e.fields } : null);

    return NextResponse.json({
      txHash,
      status,
      block,
      gasUsed,
      from:        tx.from,
      to:          tx.to,
      fromShort:   shortAddr(tx.from),
      toShort:     tx.to ? shortAddr(tx.to) : "—",
      game:        gameName,
      outcome,
      netPayout,
      events:      cleanEvents,
      transfers,
      vrfData,
      roundData,
      explorerUrl: `https://amoy.polygonscan.com/tx/${txHash}`,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found") || msg.includes("could not be found")) {
      return NextResponse.json({ error: "Transaction not found on Polygon Amoy" }, { status: 404 });
    }
    console.error("[verify/tx]", err);
    return NextResponse.json({ error: "Failed to fetch transaction" }, { status: 500 });
  }
}
