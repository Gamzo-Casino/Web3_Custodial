"use client";

import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { WHEEL_ABI, ADDRESSES } from "../contracts";
import { AMOY_GAS } from "../gasConfig";
export function useSpinWheel() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  function spin(stakeWei: bigint, riskMode: 0 | 1 | 2) {
    writeContract({
      address: ADDRESSES.wheelGame,
      abi: WHEEL_ABI,
      functionName: "spin",
      args: [stakeWei, riskMode],
      ...AMOY_GAS,
    });
  }

  let roundId: `0x${string}` | undefined;
  if (receipt) {
    const log = receipt.logs.find(
      (l) => l.address.toLowerCase() === ADDRESSES.wheelGame.toLowerCase()
    );
    if (log && log.topics[1]) roundId = log.topics[1] as `0x${string}`;
  }

  return { spin, hash, isPending, isConfirming, isSuccess, roundId, error, reset };
}

export function useWheelRound(roundId: `0x${string}` | undefined) {
  const { data, isLoading, refetch } = useReadContract({
    address: ADDRESSES.wheelGame,
    abi: WHEEL_ABI,
    functionName: "getRound",
    args: roundId ? [roundId] : undefined,
    query: {
      enabled: !!roundId,
      refetchInterval: (q) => ((q.state.data as any)?.settled ? false : 3000),
    },
  });
  return { round: data, isLoading, refetch };
}
