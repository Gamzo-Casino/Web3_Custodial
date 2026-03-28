"use client";

import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { PLINKO_ABI, ADDRESSES } from "../contracts";
import { AMOY_GAS } from "../gasConfig";
export function useDropBall() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  function dropBall(stakeWei: bigint, rows: 8 | 12 | 16, risk: 0 | 1 | 2) {
    writeContract({
      address: ADDRESSES.plinkoGame,
      abi: PLINKO_ABI,
      functionName: "dropBall",
      args: [stakeWei, rows, risk],
      gas: 600_000n,
      ...AMOY_GAS,
    });
  }

  let roundId: `0x${string}` | undefined;
  if (receipt) {
    const log = receipt.logs.find(
      (l) => l.address.toLowerCase() === ADDRESSES.plinkoGame.toLowerCase()
    );
    if (log && log.topics[1]) roundId = log.topics[1] as `0x${string}`;
  }

  return { dropBall, hash, isPending, isConfirming, isSuccess, roundId, error, reset };
}

export function usePlinkoRound(roundId: `0x${string}` | undefined) {
  const { data, isLoading, refetch } = useReadContract({
    address: ADDRESSES.plinkoGame,
    abi: PLINKO_ABI,
    functionName: "getRound",
    args: roundId ? [roundId] : undefined,
    query: {
      enabled: !!roundId,
      refetchInterval: (q) => ((q.state.data as any)?.settled ? false : 3000),
    },
  });
  return { round: data, isLoading, refetch };
}
