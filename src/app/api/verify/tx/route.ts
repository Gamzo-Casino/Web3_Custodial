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

// Map contract address → game name + ABI
function getGameRegistry() {
  return [
    { name: "Dice",      address: ADDRESSES.diceGame?.toLowerCase(),      abi: DICE_GAME_ABI      },
    { name: "Plinko",    address: ADDRESSES.plinkoGame?.toLowerCase(),     abi: PLINKO_GAME_ABI    },
    { name: "Roulette",  address: ADDRESSES.rouletteGame?.toLowerCase(),   abi: ROULETTE_GAME_ABI  },
    { name: "Mines",     address: ADDRESSES.minesGame?.toLowerCase(),      abi: MINES_GAME_ABI     },
    { name: "Blackjack", address: ADDRESSES.blackjackGame?.toLowerCase(),  abi: BLACKJACK_GAME_ABI },
    { name: "Hilo",      address: ADDRESSES.hiloGame?.toLowerCase(),       abi: HILO_GAME_ABI      },
    { name: "Keno",      address: ADDRESSES.kenoGame?.toLowerCase(),       abi: KENO_GAME_ABI      },
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
    const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
    const args = decoded.args as unknown as Record<string, unknown>;
    const eventName = decoded.eventName as unknown as string;

    const fields: Record<string, string> = {};

    // Common fields
    if (args.roundId)  fields["Round ID"]  = String(args.roundId);
    if (args.player)   fields["Player"]    = String(args.player);
    if (args.stake)    fields["Stake"]     = formatGzo(args.stake as bigint);

    // Event-specific
    switch (eventName) {
      // ── Dice ──────────────────────────────────────────────────────
      case "BetPlaced":
        if (args.targetScaled !== undefined)
          fields["Target"] = `${(Number(args.targetScaled) / 100).toFixed(2)}`;
        if (args.rows !== undefined) fields["Rows"] = String(args.rows);
        if (args.risk !== undefined) fields["Risk"] = ["Low", "Medium", "High"][Number(args.risk)] ?? String(args.risk);
        if (args.picks !== undefined) fields["Picks"] = (args.picks as number[]).join(", ");
        if (args.wagerCount !== undefined) fields["Wager Count"] = String(args.wagerCount);
        break;

      case "RoundSettled":
        if (args.roll !== undefined)  fields["Roll"]       = `${(Number(args.roll) / 100).toFixed(2)}`;
        if (args.won !== undefined)   fields["Result"]     = args.won ? "✓ WIN" : "✗ LOSS";
        if (args.netPayout !== undefined) fields["Net Payout"] = formatGzo(args.netPayout as bigint);
        if (args.fee !== undefined)   fields["Fee"]        = formatGzo(args.fee as bigint);
        if (args.pathBits !== undefined) fields["Path Bits"] = `0x${(args.pathBits as bigint).toString(16)}`;
        if (args.binIndex !== undefined) fields["Bin Index"] = String(args.binIndex);
        if (args.multiplier100 !== undefined) fields["Multiplier"] = `${(Number(args.multiplier100) / 100).toFixed(2)}×`;
        if (args.drawn !== undefined) fields["Drawn Numbers"] = (args.drawn as number[]).join(", ");
        if (args.matchCount !== undefined) fields["Matches"] = String(args.matchCount);
        break;

      // ── Roulette ──────────────────────────────────────────────────
      case "SpinPlaced":
        if (args.totalStake !== undefined) fields["Total Stake"] = formatGzo(args.totalStake as bigint);
        if (args.wagerCount !== undefined) fields["Wager Count"] = String(args.wagerCount);
        break;

      case "SpinSettled":
        if (args.winningNumber !== undefined) fields["Winning Number"] = String(args.winningNumber);
        if (args.totalGross !== undefined)    fields["Gross Payout"]   = formatGzo(args.totalGross as bigint);
        if (args.netPayout !== undefined)     fields["Net Payout"]     = formatGzo(args.netPayout as bigint);
        if (args.fee !== undefined)           fields["Fee"]            = formatGzo(args.fee as bigint);
        break;

      // ── Mines ─────────────────────────────────────────────────────
      case "RoundStarted":
        if (args.mineCount !== undefined)    fields["Mine Count"]  = String(args.mineCount);
        if (args.vrfRequestId !== undefined) fields["VRF Request"] = String(args.vrfRequestId);
        break;

      case "RoundCashedOut":
        if (args.safePicks !== undefined)    fields["Safe Tiles"]  = String(args.safePicks);
        if (args.multiplier100 !== undefined) fields["Multiplier"] = `${(Number(args.multiplier100) / 100).toFixed(2)}×`;
        if (args.netPayout !== undefined)    fields["Net Payout"]  = formatGzo(args.netPayout as bigint);
        if (args.fee !== undefined)          fields["Fee"]         = formatGzo(args.fee as bigint);
        break;

      case "RoundLost":
        if (args.hitTile !== undefined)   fields["Hit Tile"]  = String(args.hitTile);
        if (args.stepIndex !== undefined) fields["Lost Step"] = String(args.stepIndex);
        break;

      // ── Blackjack / Hilo ──────────────────────────────────────────
      case "RoundActive":
        if (args.deckSeed !== undefined) fields["Deck Seed"] = `0x${(args.deckSeed as bigint).toString(16)}`;
        break;
    }

    return {
      game:      gameName,
      event:     eventName,
      logIndex:  log.logIndex,
      address:   log.address,
      fields,
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const txHash = searchParams.get("hash")?.trim();

  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({ error: "Invalid transaction hash" }, { status: 400 });
  }

  try {
    const client   = getPublicClient();
    const registry = getGameRegistry();

    // Fetch receipt + transaction in parallel
    const [receipt, tx] = await Promise.all([
      client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
      client.getTransaction({ hash: txHash as `0x${string}` }),
    ]);

    if (!receipt) {
      return NextResponse.json({ error: "Transaction not found on Polygon Amoy" }, { status: 404 });
    }

    const status  = receipt.status === "success" ? "Success" : "Failed";
    const gasUsed = receipt.gasUsed.toString();
    const block   = receipt.blockNumber.toString();

    // Decode each log
    const events: ReturnType<typeof decodeLog>[] = [];
    const transfers: { from: string; to: string; amount: string }[] = [];

    for (const log of receipt.logs) {
      const addrLower = log.address.toLowerCase();

      // ERC-20 Transfer
      if (addrLower === ADDRESSES.gzoToken?.toLowerCase()) {
        try {
          const decoded = decodeEventLog({ abi: ERC20_TRANSFER_ABI, data: log.data, topics: log.topics });
          if (decoded.eventName === "Transfer") {
            const args = decoded.args as { from: string; to: string; value: bigint };
            transfers.push({
              from:   args.from,
              to:     args.to,
              amount: formatGzo(args.value),
            });
          }
        } catch { /* not a Transfer */ }
        continue;
      }

      // Game contract
      const game = registry.find(g => g.address && addrLower === g.address);
      if (game) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const decoded = decodeLog(log, game.abi as any, game.name);
        if (decoded) events.push(decoded);
      }
    }

    // Determine game from events
    const gameName = events.length > 0 ? (events[0]?.game as string) : "Unknown";

    // Build summary
    const placedEvent  = events.find(e => ["BetPlaced", "SpinPlaced", "RoundStarted"].includes(e?.event as string));
    const settledEvent = events.find(e => ["RoundSettled", "SpinSettled", "RoundCashedOut", "RoundLost"].includes(e?.event as string));

    let outcome = "Pending";
    let netPayout = "—";

    if (settledEvent) {
      const f = settledEvent.fields as Record<string, string>;
      if (settledEvent.event === "RoundLost")    outcome = "Lost";
      else if (f["Result"])                      outcome = f["Result"];
      else if (f["Net Payout"])                  outcome = "Won";
      netPayout = f["Net Payout"] ?? "—";
    }

    return NextResponse.json({
      txHash,
      status,
      block,
      gasUsed,
      from:       tx.from,
      to:         tx.to,
      fromShort:  shortAddr(tx.from),
      toShort:    tx.to ? shortAddr(tx.to) : "—",
      game:       gameName,
      outcome,
      netPayout,
      events,
      transfers,
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
