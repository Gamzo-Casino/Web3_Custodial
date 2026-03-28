"use client";

import { useRef } from "react";

export interface RecordBetParams {
  gameType: string;
  onchainRoundId: string;
  txHash: string;
  stakeGzo: number;
  netPayoutGzo: number;
  won: boolean;
  resultJson: object;
  contractAddress?: string;
  chainId?: number;
}

export function useRecordBet() {
  const recordedRef = useRef<Set<string>>(new Set());

  async function recordBet(params: RecordBetParams) {
    const key = `${params.gameType}:${params.onchainRoundId}`;
    if (recordedRef.current.has(key)) return;
    recordedRef.current.add(key);
    try {
      await fetch("/api/bets/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
    } catch {
      // non-fatal
    }
  }

  return { recordBet };
}
