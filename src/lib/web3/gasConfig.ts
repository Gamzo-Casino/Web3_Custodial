import { parseGwei } from "viem";

/** Polygon Amoy requires minimum 25 gwei priority fee. */
export const AMOY_GAS = {
  maxFeePerGas:         parseGwei("100"),
  maxPriorityFeePerGas: parseGwei("30"),
} as const;
