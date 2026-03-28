"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { defineChain, parseGwei } from "viem";
import { hardhat } from "wagmi/chains";

// ── Polygon Amoy testnet ───────────────────────────────────────────────────────
// Fee estimator is capped at 500 gwei because Amoy's RPC sometimes returns
// an inflated baseFee that causes viem to exceed its 1 MATIC tx-fee safety cap.
export const polygonAmoy = defineChain({
  id: 80002,
  name: "Polygon Amoy",
  nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_AMOY_RPC ?? "https://rpc-amoy.polygon.technology"],
    },
  },
  blockExplorers: {
    default: {
      name: "PolygonScan Amoy",
      url: "https://amoy.polygonscan.com",
    },
  },
  testnet: true,
  fees: {
    async estimateFeesPerGas() {
      return {
        maxFeePerGas:         parseGwei("100"),
        maxPriorityFeePerGas: parseGwei("30"),
      };
    },
  },
});

export const TARGET_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_CHAIN_ID ?? "80002"
);

// Use the env-provided WalletConnect project ID.
// If not set, fall back to WalletConnect's own public demo ID so that
// WalletConnect initialises without errors (required even for MetaMask to work).
const WC_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ||
  "3a8170812b534d0ff9d794f19a901d64";

export const wagmiConfig = getDefaultConfig({
  appName: "Gamzo Casino",
  projectId: WC_PROJECT_ID,
  chains:
    TARGET_CHAIN_ID === 80002
      ? ([polygonAmoy] as const)
      : ([hardhat] as const),
  transports:
    TARGET_CHAIN_ID === 80002
      ? { [polygonAmoy.id]: http(process.env.NEXT_PUBLIC_AMOY_RPC ?? "https://rpc-amoy.polygon.technology") }
      : { [hardhat.id]: http("http://127.0.0.1:8545") },
  ssr: false,
});
