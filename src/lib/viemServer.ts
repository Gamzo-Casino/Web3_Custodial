/**
 * Server-side viem clients.
 * Import only in Route Handlers / Server Actions — never in client components.
 */
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygonAmoy } from "viem/chains";

function getRpcUrl(): string {
  return process.env.SERVER_RPC_URL ?? "https://rpc-amoy.polygon.technology";
}

/** Read-only client — used to fetch tx receipts and verify on-chain events. */
export function getPublicClient() {
  return createPublicClient({
    chain: polygonAmoy,
    transport: http(getRpcUrl()),
  });
}

/** House wallet client — used to send GZO withdrawals to users. */
export function getHouseWalletClient() {
  const pk = process.env.HOUSE_PRIVATE_KEY;
  if (!pk) throw new Error("HOUSE_PRIVATE_KEY env var is not set");
  const account = privateKeyToAccount(pk as `0x${string}`);
  return {
    client: createWalletClient({
      account,
      chain: polygonAmoy,
      transport: http(getRpcUrl()),
    }),
    account,
  };
}

// Minimal ERC-20 ABI for transfer + Transfer event
export const ERC20_TRANSFER_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

// DiceGame v2 ABI (server-side — includes placeBetFor for custodial bets)
export const DICE_GAME_ABI = [
  {
    name: "placeBetFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player",       type: "address" },
      { name: "stake",        type: "uint256" },
      { name: "targetScaled", type: "uint256" },
    ],
    outputs: [{ name: "roundId", type: "bytes32" }],
  },
  {
    name: "getRound",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "bytes32" }],
    outputs: [
      {
        name: "r",
        type: "tuple",
        components: [
          { name: "player",       type: "address" },
          { name: "stake",        type: "uint256" },
          { name: "targetScaled", type: "uint256" },
          { name: "roll",         type: "uint256" },
          { name: "netPayout",    type: "uint256" },
          { name: "won",          type: "bool" },
          { name: "settled",      type: "bool" },
          { name: "createdAt",    type: "uint64" },
          { name: "custodial",    type: "bool" },
        ],
      },
    ],
  },
  {
    name: "BetPlaced",
    type: "event",
    inputs: [
      { name: "roundId",      type: "bytes32", indexed: true },
      { name: "player",       type: "address", indexed: true },
      { name: "stake",        type: "uint256", indexed: false },
      { name: "targetScaled", type: "uint256", indexed: false },
    ],
  },
  {
    name: "RoundSettled",
    type: "event",
    inputs: [
      { name: "roundId",   type: "bytes32", indexed: true },
      { name: "player",    type: "address", indexed: true },
      { name: "roll",      type: "uint256", indexed: false },
      { name: "won",       type: "bool",    indexed: false },
      { name: "netPayout", type: "uint256", indexed: false },
      { name: "fee",       type: "uint256", indexed: false },
    ],
  },
] as const;

// PlinkoGame v2 ABI (server-side — includes dropBallFor for custodial bets)
export const PLINKO_GAME_ABI = [
  {
    name: "dropBallFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player", type: "address" },
      { name: "stake",  type: "uint256" },
      { name: "rows",   type: "uint8"   },
      { name: "risk",   type: "uint8"   },
    ],
    outputs: [{ name: "roundId", type: "bytes32" }],
  },
  {
    name: "getRound",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "bytes32" }],
    outputs: [
      {
        name: "r",
        type: "tuple",
        components: [
          { name: "player",       type: "address" },
          { name: "stake",        type: "uint256" },
          { name: "rows",         type: "uint8"   },
          { name: "risk",         type: "uint8"   },
          { name: "pathBits",     type: "uint256" },
          { name: "binIndex",     type: "uint256" },
          { name: "multiplier100", type: "uint256" },
          { name: "netPayout",    type: "uint256" },
          { name: "settled",      type: "bool"    },
          { name: "createdAt",    type: "uint64"  },
          { name: "custodial",    type: "bool"    },
        ],
      },
    ],
  },
  {
    name: "BetPlaced",
    type: "event",
    inputs: [
      { name: "roundId", type: "bytes32", indexed: true  },
      { name: "player",  type: "address", indexed: true  },
      { name: "stake",   type: "uint256", indexed: false },
      { name: "rows",    type: "uint8",   indexed: false },
      { name: "risk",    type: "uint8",   indexed: false },
    ],
  },
  {
    name: "RoundSettled",
    type: "event",
    inputs: [
      { name: "roundId",      type: "bytes32", indexed: true  },
      { name: "player",       type: "address", indexed: true  },
      { name: "pathBits",     type: "uint256", indexed: false },
      { name: "binIndex",     type: "uint256", indexed: false },
      { name: "multiplier100", type: "uint256", indexed: false },
      { name: "netPayout",    type: "uint256", indexed: false },
      { name: "fee",          type: "uint256", indexed: false },
    ],
  },
] as const;

// RouletteGame v2 ABI (server-side — includes spinFor for custodial bets)
export const ROULETTE_GAME_ABI = [
  {
    name: "spinFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player",   type: "address"  },
      { name: "betTypes", type: "uint8[]"  },
      { name: "stakes",   type: "uint256[]" },
    ],
    outputs: [{ name: "roundId", type: "bytes32" }],
  },
  {
    name: "getRound",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "bytes32" }],
    outputs: [
      {
        name: "r",
        type: "tuple",
        components: [
          { name: "player",        type: "address" },
          { name: "totalStake",    type: "uint256" },
          { name: "winningNumber", type: "uint256" },
          { name: "totalGross",    type: "uint256" },
          { name: "netPayout",     type: "uint256" },
          { name: "settled",       type: "bool"    },
          { name: "createdAt",     type: "uint64"  },
          { name: "custodial",     type: "bool"    },
        ],
      },
    ],
  },
  {
    name: "SpinPlaced",
    type: "event",
    inputs: [
      { name: "roundId",     type: "bytes32", indexed: true  },
      { name: "player",      type: "address", indexed: true  },
      { name: "totalStake",  type: "uint256", indexed: false },
      { name: "wagerCount",  type: "uint256", indexed: false },
    ],
  },
  {
    name: "SpinSettled",
    type: "event",
    inputs: [
      { name: "roundId",       type: "bytes32", indexed: true  },
      { name: "player",        type: "address", indexed: true  },
      { name: "winningNumber", type: "uint256", indexed: false },
      { name: "totalGross",    type: "uint256", indexed: false },
      { name: "netPayout",     type: "uint256", indexed: false },
      { name: "fee",           type: "uint256", indexed: false },
    ],
  },
] as const;

// MinesGame v2 ABI (server-side — includes startRoundFor, cashoutFor, loseRoundFor for custodial bets)
export const MINES_GAME_ABI = [
  {
    name: "startRoundFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player",    type: "address" },
      { name: "stake",     type: "uint256" },
      { name: "mineCount", type: "uint8"   },
    ],
    outputs: [{ name: "roundId", type: "bytes32" }],
  },
  {
    name: "cashoutFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roundId",       type: "bytes32" },
      { name: "revealedTiles", type: "uint8[]" },
    ],
    outputs: [],
  },
  {
    name: "loseRoundFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roundId", type: "bytes32" },
      { name: "hitTile", type: "uint8"   },
    ],
    outputs: [],
  },
  {
    name: "getMinePositions",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "bytes32" }],
    outputs: [{ name: "positions", type: "uint8[]" }],
  },
  {
    name: "getRound",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "bytes32" }],
    outputs: [
      {
        name: "r",
        type: "tuple",
        components: [
          { name: "player",       type: "address" },
          { name: "stake",        type: "uint256" },
          { name: "mineCount",    type: "uint8"   },
          { name: "vrfSeed",      type: "uint256" },
          { name: "vrfRequestId", type: "uint256" },
          { name: "status",       type: "uint8"   },  // 0=PENDING,1=ACTIVE,2=CASHED_OUT,3=LOST,4=REFUNDED
          { name: "safePicks",    type: "uint256" },
          { name: "multiplier100", type: "uint256" },
          { name: "netPayout",    type: "uint256" },
          { name: "createdAt",    type: "uint64"  },
          { name: "settledAt",    type: "uint64"  },
          { name: "custodial",    type: "bool"    },
        ],
      },
    ],
  },
  {
    name: "RoundStarted",
    type: "event",
    inputs: [
      { name: "roundId",      type: "bytes32", indexed: true  },
      { name: "player",       type: "address", indexed: true  },
      { name: "stake",        type: "uint256", indexed: false },
      { name: "mineCount",    type: "uint8",   indexed: false },
      { name: "vrfRequestId", type: "uint256", indexed: false },
    ],
  },
  {
    name: "RoundCashedOut",
    type: "event",
    inputs: [
      { name: "roundId",     type: "bytes32", indexed: true  },
      { name: "player",      type: "address", indexed: true  },
      { name: "safePicks",   type: "uint256", indexed: false },
      { name: "multiplier100", type: "uint256", indexed: false },
      { name: "netPayout",   type: "uint256", indexed: false },
      { name: "fee",         type: "uint256", indexed: false },
    ],
  },
  {
    name: "RoundLost",
    type: "event",
    inputs: [
      { name: "roundId", type: "bytes32", indexed: true  },
      { name: "player",  type: "address", indexed: true  },
      { name: "hitTile", type: "uint8",   indexed: false },
    ],
  },
] as const;

// BlackjackGame v2 ABI (server-side — includes startRoundFor, lockSplitFor for custodial bets)
export const BLACKJACK_GAME_ABI = [
  {
    name: "startRoundFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player", type: "address" },
      { name: "stake",  type: "uint256" },
    ],
    outputs: [{ name: "roundId", type: "bytes32" }],
  },
  {
    name: "lockSplitFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "roundId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "settleRound",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roundId",          type: "bytes32" },
      { name: "playerCards",      type: "uint8[]" },
      { name: "dealerCards",      type: "uint8[]" },
      { name: "playerPositions",  type: "uint8[]" },
      { name: "dealerPositions",  type: "uint8[]" },
      { name: "splitCards",       type: "uint8[]" },
      { name: "splitPositions",   type: "uint8[]" },
      { name: "didDouble",        type: "bool"    },
    ],
    outputs: [],
  },
  {
    name: "getRound",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "bytes32" }],
    outputs: [
      {
        name: "r",
        type: "tuple",
        components: [
          { name: "player",       type: "address" },
          { name: "stake",        type: "uint256" },
          { name: "splitStake",   type: "uint256" },
          { name: "doubleStake",  type: "uint256" },
          { name: "deckSeed",     type: "uint256" },
          { name: "vrfRequestId", type: "uint256" },
          { name: "status",       type: "uint8"   }, // 0=PENDING,1=ACTIVE,2=SETTLED,3=REFUNDED
          { name: "netPayout",    type: "uint256" },
          { name: "createdAt",    type: "uint64"  },
          { name: "settledAt",    type: "uint64"  },
          { name: "custodial",    type: "bool"    },
        ],
      },
    ],
  },
  {
    name: "RoundStarted",
    type: "event",
    inputs: [
      { name: "roundId",      type: "bytes32", indexed: true  },
      { name: "player",       type: "address", indexed: true  },
      { name: "stake",        type: "uint256", indexed: false },
      { name: "vrfRequestId", type: "uint256", indexed: false },
    ],
  },
  {
    name: "RoundActive",
    type: "event",
    inputs: [
      { name: "roundId",  type: "bytes32", indexed: true  },
      { name: "deckSeed", type: "uint256", indexed: false },
    ],
  },
  {
    name: "RoundSettled",
    type: "event",
    inputs: [
      { name: "roundId",   type: "bytes32", indexed: true  },
      { name: "player",    type: "address", indexed: true  },
      { name: "netPayout", type: "uint256", indexed: false },
      { name: "fee",       type: "uint256", indexed: false },
    ],
  },
] as const;

// HiloGame v2 ABI (server-side — includes startRoundFor for custodial bets)
export const HILO_GAME_ABI = [
  {
    name: "startRoundFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player", type: "address" },
      { name: "stake",  type: "uint256" },
    ],
    outputs: [{ name: "roundId", type: "bytes32" }],
  },
  {
    name: "cashout",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roundId",   type: "bytes32" },
      { name: "cards",     type: "uint8[]" },
      { name: "positions", type: "uint8[]" },
      { name: "guesses",   type: "uint8[]" },
      { name: "cashoutAt", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "loseRound",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roundId",    type: "bytes32" },
      { name: "cards",      type: "uint8[]" },
      { name: "positions",  type: "uint8[]" },
      { name: "guesses",    type: "uint8[]" },
      { name: "lostAtStep", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "getRound",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "bytes32" }],
    outputs: [
      {
        name: "r",
        type: "tuple",
        components: [
          { name: "player",       type: "address" },
          { name: "stake",        type: "uint256" },
          { name: "deckSeed",     type: "uint256" },
          { name: "vrfRequestId", type: "uint256" },
          { name: "status",       type: "uint8"   }, // 0=PENDING,1=ACTIVE,2=CASHED_OUT,3=LOST,4=REFUNDED
          { name: "multiplier100", type: "uint256" },
          { name: "netPayout",    type: "uint256" },
          { name: "createdAt",    type: "uint64"  },
          { name: "settledAt",    type: "uint64"  },
          { name: "custodial",    type: "bool"    },
        ],
      },
    ],
  },
  {
    name: "RoundStarted",
    type: "event",
    inputs: [
      { name: "roundId",      type: "bytes32", indexed: true  },
      { name: "player",       type: "address", indexed: true  },
      { name: "stake",        type: "uint256", indexed: false },
      { name: "vrfRequestId", type: "uint256", indexed: false },
    ],
  },
  {
    name: "RoundActive",
    type: "event",
    inputs: [
      { name: "roundId",  type: "bytes32", indexed: true  },
      { name: "deckSeed", type: "uint256", indexed: false },
    ],
  },
  {
    name: "RoundCashedOut",
    type: "event",
    inputs: [
      { name: "roundId",      type: "bytes32", indexed: true  },
      { name: "player",       type: "address", indexed: true  },
      { name: "multiplier100", type: "uint256", indexed: false },
      { name: "netPayout",    type: "uint256", indexed: false },
      { name: "fee",          type: "uint256", indexed: false },
    ],
  },
  {
    name: "RoundLost",
    type: "event",
    inputs: [
      { name: "roundId",   type: "bytes32", indexed: true  },
      { name: "player",    type: "address", indexed: true  },
      { name: "stepIndex", type: "uint256", indexed: false },
    ],
  },
] as const;

// KenoGame v2 ABI (server-side — includes placeBetFor for custodial bets)
export const KENO_GAME_ABI = [
  {
    name: "placeBetFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player", type: "address" },
      { name: "stake",  type: "uint256" },
      { name: "picks",  type: "uint8[]" },
    ],
    outputs: [{ name: "roundId", type: "bytes32" }],
  },
  {
    name: "getRound",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "bytes32" }],
    outputs: [
      {
        name: "r",
        type: "tuple",
        components: [
          { name: "player",       type: "address"   },
          { name: "stake",        type: "uint256"   },
          { name: "picks",        type: "uint8[]"   },
          { name: "drawn",        type: "uint8[10]" },
          { name: "matchCount",   type: "uint256"   },
          { name: "multiplier100", type: "uint256"  },
          { name: "netPayout",    type: "uint256"   },
          { name: "settled",      type: "bool"      },
          { name: "createdAt",    type: "uint64"    },
          { name: "custodial",    type: "bool"      },
        ],
      },
    ],
  },
  {
    name: "BetPlaced",
    type: "event",
    inputs: [
      { name: "roundId", type: "bytes32", indexed: true  },
      { name: "player",  type: "address", indexed: true  },
      { name: "stake",   type: "uint256", indexed: false },
      { name: "picks",   type: "uint8[]", indexed: false },
    ],
  },
  {
    name: "RoundSettled",
    type: "event",
    inputs: [
      { name: "roundId",      type: "bytes32",  indexed: true  },
      { name: "player",       type: "address",  indexed: true  },
      { name: "drawn",        type: "uint8[10]", indexed: false },
      { name: "matchCount",   type: "uint256",  indexed: false },
      { name: "multiplier100", type: "uint256", indexed: false },
      { name: "netPayout",    type: "uint256",  indexed: false },
      { name: "fee",          type: "uint256",  indexed: false },
    ],
  },
] as const;
