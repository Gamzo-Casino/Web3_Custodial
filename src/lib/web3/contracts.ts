import deployedAddresses from "./deployed-addresses.json";

// ── ABIs ───────────────────────────────────────────────────────────────────────

export const GZO_ABI = [
  // ERC-20
  { name: "balanceOf",   type: "function", stateMutability: "view",       inputs: [{ name: "account", type: "address" }],                          outputs: [{ type: "uint256" }] },
  { name: "allowance",   type: "function", stateMutability: "view",       inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve",     type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "transfer",    type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],      outputs: [{ type: "bool" }] },
  { name: "decimals",    type: "function", stateMutability: "view",       inputs: [],                                                              outputs: [{ type: "uint8" }] },
  { name: "symbol",      type: "function", stateMutability: "view",       inputs: [],                                                              outputs: [{ type: "string" }] },
  // Faucet (testnet)
  { name: "faucet",      type: "function", stateMutability: "nonpayable", inputs: [],                                                              outputs: [] },
  // Events
  { name: "Transfer",    type: "event", inputs: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "value", type: "uint256" }] },
  { name: "Approval",    type: "event", inputs: [{ name: "owner", type: "address", indexed: true }, { name: "spender", type: "address", indexed: true }, { name: "value", type: "uint256" }] },
] as const;

export const COINFLIP_ABI = [
  { name: "createMatch",  type: "function", stateMutability: "nonpayable", inputs: [{ name: "stake", type: "uint256" }, { name: "side", type: "uint8" }],  outputs: [{ name: "roundId", type: "bytes32" }] },
  { name: "joinMatch",    type: "function", stateMutability: "nonpayable", inputs: [{ name: "roundId", type: "bytes32" }],                                 outputs: [] },
  { name: "cancelMatch",  type: "function", stateMutability: "nonpayable", inputs: [{ name: "roundId", type: "bytes32" }],                                 outputs: [] },
  { name: "getMatch",     type: "function", stateMutability: "view",       inputs: [{ name: "roundId", type: "bytes32" }],                                 outputs: [{ name: "m", type: "tuple", components: [
    { name: "playerA",      type: "address" },
    { name: "playerB",      type: "address" },
    { name: "stake",        type: "uint256" },
    { name: "playerAChoice",type: "uint8" },
    { name: "outcome",      type: "uint8" },
    { name: "winner",       type: "address" },
    { name: "status",       type: "uint8" },
    { name: "vrfRequestId", type: "uint256" },
    { name: "createdAt",    type: "uint64" },
    { name: "settledAt",    type: "uint64" },
  ] }] },
  { name: "minStake", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "maxStake", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  // Events
  { name: "MatchCreated",   type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "playerA", type: "address", indexed: true }, { name: "stake", type: "uint256" }, { name: "side", type: "uint8" }] },
  { name: "MatchJoined",    type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "playerB", type: "address", indexed: true }, { name: "vrfRequestId", type: "uint256" }] },
  { name: "MatchSettled",   type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "outcome", type: "uint8" }, { name: "winner", type: "address", indexed: true }, { name: "netPayout", type: "uint256" }, { name: "fee", type: "uint256" }] },
  { name: "MatchCancelled", type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "playerA", type: "address", indexed: true }] },
] as const;

export const DICE_ABI = [
  // Original on-chain escrow bet (player calls, tokens pulled from wallet)
  { name: "placeBet",    type: "function", stateMutability: "nonpayable", inputs: [{ name: "stake", type: "uint256" }, { name: "targetScaled", type: "uint256" }], outputs: [{ name: "roundId", type: "bytes32" }] },
  // v2: Custodial bet — operator (house) calls on behalf of player; no token transfer from player
  { name: "placeBetFor", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "player", type: "address" }, { name: "stake", type: "uint256" }, { name: "targetScaled", type: "uint256" }],
    outputs: [{ name: "roundId", type: "bytes32" }] },
  { name: "getRound",  type: "function", stateMutability: "view", inputs: [{ name: "roundId", type: "bytes32" }], outputs: [{ name: "r", type: "tuple", components: [
    { name: "player",       type: "address" },
    { name: "stake",        type: "uint256" },
    { name: "targetScaled", type: "uint256" },
    { name: "roll",         type: "uint256" },
    { name: "netPayout",    type: "uint256" },
    { name: "won",          type: "bool" },
    { name: "settled",      type: "bool" },
    { name: "createdAt",    type: "uint64" },
    { name: "custodial",    type: "bool" },
  ] }] },
  { name: "BetPlaced",    type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "stake", type: "uint256" }, { name: "targetScaled", type: "uint256" }] },
  { name: "RoundSettled", type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "roll", type: "uint256" }, { name: "won", type: "bool" }, { name: "netPayout", type: "uint256" }, { name: "fee", type: "uint256" }] },
] as const;

export const WHEEL_ABI = [
  { name: "spin",     type: "function", stateMutability: "nonpayable", inputs: [{ name: "stake", type: "uint256" }, { name: "riskMode", type: "uint8" }], outputs: [{ name: "roundId", type: "bytes32" }] },
  { name: "getRound", type: "function", stateMutability: "view",       inputs: [{ name: "roundId", type: "bytes32" }], outputs: [{ name: "r", type: "tuple", components: [
    { name: "player", type: "address" }, { name: "stake", type: "uint256" }, { name: "riskMode", type: "uint8" },
    { name: "stopPosition", type: "uint256" }, { name: "segmentIndex", type: "uint8" }, { name: "multiplier100", type: "uint32" },
    { name: "netPayout", type: "uint256" }, { name: "settled", type: "bool" }, { name: "createdAt", type: "uint64" },
  ] }] },
  { name: "minStake", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "maxStake", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "SpinPlaced",   type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "stake", type: "uint256" }, { name: "riskMode", type: "uint8" }] },
  { name: "RoundSettled", type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "stopPosition", type: "uint256" }, { name: "multiplier100", type: "uint32" }, { name: "netPayout", type: "uint256" }, { name: "fee", type: "uint256" }] },
] as const;

export const ROULETTE_ABI = [
  { name: "spin",     type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "betTypes", type: "uint8[]" },
      { name: "stakes",   type: "uint256[]" },
    ],
    outputs: [{ name: "roundId", type: "bytes32" }] },
  { name: "getRound", type: "function", stateMutability: "view", inputs: [{ name: "roundId", type: "bytes32" }], outputs: [{ name: "r", type: "tuple", components: [
    { name: "player", type: "address" }, { name: "totalStake", type: "uint256" }, { name: "winningNumber", type: "uint256" },
    { name: "totalGross", type: "uint256" }, { name: "netPayout", type: "uint256" },
    { name: "settled", type: "bool" }, { name: "createdAt", type: "uint64" },
  ] }] },
  { name: "minStake", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "maxStake", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "SpinPlaced",   type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "totalStake", type: "uint256" }, { name: "wagerCount", type: "uint256" }] },
  { name: "SpinSettled",  type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "winningNumber", type: "uint256" }, { name: "totalGross", type: "uint256" }, { name: "netPayout", type: "uint256" }, { name: "fee", type: "uint256" }] },
] as const;

export const PLINKO_ABI = [
  { name: "dropBall",  type: "function", stateMutability: "nonpayable", inputs: [{ name: "stake", type: "uint256" }, { name: "rows", type: "uint8" }, { name: "risk", type: "uint8" }], outputs: [{ name: "roundId", type: "bytes32" }] },
  { name: "getRound",  type: "function", stateMutability: "view",       inputs: [{ name: "roundId", type: "bytes32" }], outputs: [{ name: "r", type: "tuple", components: [
    { name: "player", type: "address" }, { name: "stake", type: "uint256" }, { name: "rows", type: "uint8" }, { name: "risk", type: "uint8" },
    { name: "pathBits", type: "uint256" }, { name: "binIndex", type: "uint8" }, { name: "multiplier100", type: "uint256" },
    { name: "netPayout", type: "uint256" }, { name: "settled", type: "bool" }, { name: "createdAt", type: "uint64" },
  ] }] },
  { name: "minStake", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "maxStake", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "BallDropped",  type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "stake", type: "uint256" }, { name: "rows", type: "uint8" }, { name: "risk", type: "uint8" }] },
  { name: "RoundSettled", type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "binIndex", type: "uint8" }, { name: "multiplier100", type: "uint256" }, { name: "netPayout", type: "uint256" }, { name: "fee", type: "uint256" }] },
] as const;

export const KENO_ABI = [
  { name: "placeBet",  type: "function", stateMutability: "nonpayable", inputs: [{ name: "stake", type: "uint256" }, { name: "picks", type: "uint8[]" }], outputs: [{ name: "roundId", type: "bytes32" }] },
  { name: "getRound",  type: "function", stateMutability: "view",       inputs: [{ name: "roundId", type: "bytes32" }], outputs: [{ name: "r", type: "tuple", components: [
    { name: "player",        type: "address"   },
    { name: "stake",         type: "uint256"   },
    { name: "picks",         type: "uint8[]"   },
    { name: "drawn",         type: "uint8[10]" },
    { name: "matchCount",    type: "uint256"   },
    { name: "multiplier100", type: "uint256"   },
    { name: "netPayout",     type: "uint256"   },
    { name: "settled",       type: "bool"      },
    { name: "createdAt",     type: "uint64"    },
  ] }] },
  { name: "refundStuck", type: "function", stateMutability: "nonpayable", inputs: [{ name: "roundId", type: "bytes32" }], outputs: [] },
  { name: "REFUND_DELAY", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "minStake", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "maxStake", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "BetPlaced",    type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "stake", type: "uint256" }, { name: "picks", type: "uint8[]" }] },
  { name: "RoundSettled", type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "drawn", type: "uint8[10]" }, { name: "matchCount", type: "uint256" }, { name: "multiplier100", type: "uint256" }, { name: "netPayout", type: "uint256" }, { name: "fee", type: "uint256" }] },
] as const;

export const MINES_ABI = [
  { name: "startRound",       type: "function", stateMutability: "nonpayable", inputs: [{ name: "stake", type: "uint256" }, { name: "mineCount", type: "uint8" }], outputs: [{ name: "roundId", type: "bytes32" }] },
  { name: "cashout",          type: "function", stateMutability: "nonpayable", inputs: [{ name: "roundId", type: "bytes32" }, { name: "revealedTiles", type: "uint8[]" }], outputs: [] },
  { name: "loseRound",        type: "function", stateMutability: "nonpayable", inputs: [{ name: "roundId", type: "bytes32" }, { name: "hitTile", type: "uint8" }], outputs: [] },
  { name: "refundPending",    type: "function", stateMutability: "nonpayable", inputs: [{ name: "roundId", type: "bytes32" }], outputs: [] },
  { name: "getMinePositions", type: "function", stateMutability: "view",       inputs: [{ name: "roundId", type: "bytes32" }], outputs: [{ name: "positions", type: "uint8[]" }] },
  { name: "getRound",         type: "function", stateMutability: "view",       inputs: [{ name: "roundId", type: "bytes32" }], outputs: [{ name: "r", type: "tuple", components: [
    { name: "player",        type: "address" },
    { name: "stake",         type: "uint256" },
    { name: "mineCount",     type: "uint8" },
    { name: "vrfSeed",       type: "uint256" },
    { name: "vrfRequestId",  type: "uint256" },
    { name: "status",        type: "uint8" },
    { name: "safePicks",     type: "uint256" },
    { name: "multiplier100", type: "uint256" },
    { name: "netPayout",     type: "uint256" },
    { name: "createdAt",     type: "uint64" },
    { name: "settledAt",     type: "uint64" },
  ] }] },
  { name: "activeRound",  type: "function", stateMutability: "view", inputs: [{ name: "player", type: "address" }], outputs: [{ type: "bytes32" }] },
  { name: "minStake",     type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "maxStake",     type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "RoundStarted",  type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "stake", type: "uint256" }, { name: "mineCount", type: "uint8" }, { name: "vrfRequestId", type: "uint256" }] },
  { name: "RoundActive",   type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "vrfSeed", type: "uint256" }] },
  { name: "RoundCashedOut",type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "safePicks", type: "uint256" }, { name: "multiplier100", type: "uint256" }, { name: "netPayout", type: "uint256" }, { name: "fee", type: "uint256" }] },
  { name: "RoundLost",     type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "hitTile", type: "uint8" }] },
  { name: "RoundRefunded", type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }] },
] as const;

export const BLACKJACK_ABI = [
  { name: "startRound",    type: "function", stateMutability: "nonpayable", inputs: [{ name: "stake", type: "uint256" }], outputs: [{ name: "roundId", type: "bytes32" }] },
  { name: "lockDouble",    type: "function", stateMutability: "nonpayable", inputs: [{ name: "roundId", type: "bytes32" }], outputs: [] },
  { name: "lockSplit",     type: "function", stateMutability: "nonpayable", inputs: [{ name: "roundId", type: "bytes32" }], outputs: [] },
  { name: "settleRound",   type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "roundId",         type: "bytes32" },
      { name: "playerCards",     type: "uint8[]" },
      { name: "dealerCards",     type: "uint8[]" },
      { name: "playerPositions", type: "uint8[]" },
      { name: "dealerPositions", type: "uint8[]" },
      { name: "splitCards",      type: "uint8[]" },
      { name: "splitPositions",  type: "uint8[]" },
      { name: "didDouble",       type: "bool" },
    ],
    outputs: [] },
  { name: "refundPending", type: "function", stateMutability: "nonpayable", inputs: [{ name: "roundId", type: "bytes32" }], outputs: [] },
  { name: "getDeckOrder",  type: "function", stateMutability: "view",       inputs: [{ name: "roundId", type: "bytes32" }], outputs: [{ name: "deck", type: "uint8[52]" }] },
  { name: "getRound",      type: "function", stateMutability: "view",       inputs: [{ name: "roundId", type: "bytes32" }], outputs: [{ name: "r", type: "tuple", components: [
    { name: "player",       type: "address" },
    { name: "stake",        type: "uint256" },
    { name: "splitStake",   type: "uint256" },
    { name: "doubleStake",  type: "uint256" },
    { name: "deckSeed",     type: "uint256" },
    { name: "vrfRequestId", type: "uint256" },
    { name: "status",       type: "uint8" },
    { name: "netPayout",    type: "uint256" },
    { name: "createdAt",    type: "uint64" },
    { name: "settledAt",    type: "uint64" },
  ] }] },
  { name: "activeRound",  type: "function", stateMutability: "view", inputs: [{ name: "player", type: "address" }], outputs: [{ type: "bytes32" }] },
  { name: "minStake",     type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "maxStake",     type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "RoundStarted",  type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "stake", type: "uint256" }, { name: "vrfRequestId", type: "uint256" }] },
  { name: "RoundActive",   type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "deckSeed", type: "uint256" }] },
  { name: "RoundSettled",  type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "netPayout", type: "uint256" }, { name: "fee", type: "uint256" }] },
  { name: "RoundRefunded", type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }] },
  { name: "SplitLocked",   type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "splitStake", type: "uint256" }] },
] as const;

export const HILO_ABI = [
  { name: "startRound",    type: "function", stateMutability: "nonpayable", inputs: [{ name: "stake", type: "uint256" }], outputs: [{ name: "roundId", type: "bytes32" }] },
  { name: "cashout",       type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "roundId",   type: "bytes32" },
      { name: "cards",     type: "uint8[]" },
      { name: "positions", type: "uint8[]" },
      { name: "guesses",   type: "uint8[]" },
      { name: "cashoutAt", type: "uint256" },
    ],
    outputs: [] },
  { name: "loseRound",     type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "roundId",    type: "bytes32" },
      { name: "cards",      type: "uint8[]" },
      { name: "positions",  type: "uint8[]" },
      { name: "guesses",    type: "uint8[]" },
      { name: "lostAtStep", type: "uint256" },
    ],
    outputs: [] },
  { name: "refundPending", type: "function", stateMutability: "nonpayable", inputs: [{ name: "roundId", type: "bytes32" }], outputs: [] },
  { name: "getDeckOrder",  type: "function", stateMutability: "view",       inputs: [{ name: "roundId", type: "bytes32" }], outputs: [{ name: "deck", type: "uint8[52]" }] },
  { name: "getRound",      type: "function", stateMutability: "view",       inputs: [{ name: "roundId", type: "bytes32" }], outputs: [{ name: "r", type: "tuple", components: [
    { name: "player",        type: "address" },
    { name: "stake",         type: "uint256" },
    { name: "deckSeed",      type: "uint256" },
    { name: "vrfRequestId",  type: "uint256" },
    { name: "status",        type: "uint8" },
    { name: "multiplier100", type: "uint256" },
    { name: "netPayout",     type: "uint256" },
    { name: "createdAt",     type: "uint64" },
    { name: "settledAt",     type: "uint64" },
  ] }] },
  { name: "activeRound",      type: "function", stateMutability: "view", inputs: [{ name: "player", type: "address" }], outputs: [{ type: "bytes32" }] },
  { name: "minStake",         type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "maxStake",         type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "maxMultiplier100", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "RoundStarted",   type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "stake", type: "uint256" }, { name: "vrfRequestId", type: "uint256" }] },
  { name: "RoundActive",    type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "deckSeed", type: "uint256" }] },
  { name: "RoundCashedOut", type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "multiplier100", type: "uint256" }, { name: "netPayout", type: "uint256" }, { name: "fee", type: "uint256" }] },
  { name: "RoundLost",      type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "stepIndex", type: "uint256" }] },
  { name: "RoundRefunded",  type: "event", inputs: [{ name: "roundId", type: "bytes32", indexed: true }, { name: "player", type: "address", indexed: true }] },
] as const;

export const TREASURY_ABI = [
  { name: "canPay",      type: "function", stateMutability: "view", inputs: [{ name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "totalLocked", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

// ── Addresses ──────────────────────────────────────────────────────────────────

const d = deployedAddresses as unknown as Record<string, string>;

export const ADDRESSES = {
  gzoToken:              d.gzoToken              as `0x${string}`,
  treasuryVault:         d.treasuryVault         as `0x${string}`,
  gameRegistry:          d.gameRegistry          as `0x${string}`,
  randomnessCoordinator: d.randomnessCoordinator as `0x${string}`,
  coinFlipGame:          d.coinFlipGame          as `0x${string}`,
  diceGame:              d.diceGame              as `0x${string}`,
  wheelGame:             d.wheelGame             as `0x${string}`,
  rouletteGame:          d.rouletteGame          as `0x${string}`,
  plinkoGame:            d.plinkoGame            as `0x${string}`,
  kenoGame:              d.kenoGame              as `0x${string}`,
  minesGame:             d.minesGame             as `0x${string}`,
  blackjackGame:         d.blackjackGame         as `0x${string}`,
  hiloGame:              d.hiloGame              as `0x${string}`,
};

export const EXPLORER_URL =
  Number(deployedAddresses.chainId) === 80002
    ? "https://amoy.polygonscan.com"
    : "http://localhost:8545"; // hardhat local has no explorer

export function txLink(hash: string) {
  if (Number(deployedAddresses.chainId) === 80002) {
    return `${EXPLORER_URL}/tx/${hash}`;
  }
  return null;
}
