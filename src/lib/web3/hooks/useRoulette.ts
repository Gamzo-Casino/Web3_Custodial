"use client";

import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { ROULETTE_ABI, ADDRESSES } from "../contracts";
import { AMOY_GAS } from "../gasConfig";

export function useSpinRoulette() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  function spin(betTypes: number[], stakes: bigint[]) {
    writeContract({
      address: ADDRESSES.rouletteGame,
      abi: ROULETTE_ABI,
      functionName: "spin",
      args: [betTypes, stakes],
      gas: 800_000n,
      ...AMOY_GAS,
    });
  }

  let roundId: `0x${string}` | undefined;
  if (receipt) {
    const log = receipt.logs.find(
      (l) => l.address.toLowerCase() === ADDRESSES.rouletteGame.toLowerCase()
    );
    if (log && log.topics[1]) roundId = log.topics[1] as `0x${string}`;
  }

  return { spin, hash, isPending, isConfirming, isSuccess, roundId, error, reset };
}

export function useRouletteRound(roundId: `0x${string}` | undefined) {
  const { data, isLoading, refetch } = useReadContract({
    address: ADDRESSES.rouletteGame,
    abi: ROULETTE_ABI,
    functionName: "getRound",
    args: roundId ? [roundId] : undefined,
    query: {
      enabled: !!roundId,
      refetchInterval: (q) => ((q.state.data as any)?.settled ? false : 3000),
    },
  });
  return { round: data, isLoading, refetch };
}
