"use client";

import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { KENO_ABI, ADDRESSES } from "../contracts";
import { AMOY_GAS } from "../gasConfig";

export function useKenoRefundStuck() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function refundStuck(roundId: `0x${string}`) {
    writeContract({
      address: ADDRESSES.kenoGame,
      abi: KENO_ABI,
      functionName: "refundStuck",
      args: [roundId],
      ...AMOY_GAS,
      gas: BigInt(200_000),
    });
  }

  return { refundStuck, hash, isPending, isConfirming, isSuccess, error, reset };
}
export function usePlaceKenoBet() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  function placeBet(stakeWei: bigint, picks: number[]) {
    writeContract({
      address: ADDRESSES.kenoGame,
      abi: KENO_ABI,
      functionName: "placeBet",
      args: [stakeWei, picks],
      ...AMOY_GAS,
      gas: BigInt(600_000),
    });
  }

  let roundId: `0x${string}` | undefined;
  if (receipt) {
    const log = receipt.logs.find(
      (l) => l.address.toLowerCase() === ADDRESSES.kenoGame.toLowerCase()
    );
    if (log && log.topics[1]) roundId = log.topics[1] as `0x${string}`;
  }

  return { placeBet, hash, isPending, isConfirming, isSuccess, roundId, error, reset };
}

export function useKenoRound(roundId: `0x${string}` | undefined) {
  const { data, isLoading, refetch } = useReadContract({
    address: ADDRESSES.kenoGame,
    abi: KENO_ABI,
    functionName: "getRound",
    args: roundId ? [roundId] : undefined,
    query: {
      enabled: !!roundId,
      // Poll every 2 s while unsettled; stop once settled
      refetchInterval: (q) => ((q.state.data as any)?.settled ? false : 2000),
      // Don't serve stale data — always fetch fresh when switching tabs
      staleTime: 0,
    },
  });
  return { round: data, isLoading, refetch };
}
