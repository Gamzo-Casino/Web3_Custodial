"use client";

import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { COINFLIP_ABI, ADDRESSES } from "../contracts";
import { AMOY_GAS } from "../gasConfig";
export function useCreateMatch() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  function createMatch(stakeWei: bigint, side: 0 | 1) {
    writeContract({
      address: ADDRESSES.coinFlipGame,
      abi: COINFLIP_ABI,
      functionName: "createMatch",
      args: [stakeWei, side],
      ...AMOY_GAS,
    });
  }

  // Extract roundId from MatchCreated event log
  let roundId: `0x${string}` | undefined;
  if (receipt) {
    // The roundId is emitted as the first indexed topic in MatchCreated
    // topic[0] = event sig, topic[1] = roundId, topic[2] = playerA
    const log = receipt.logs.find(
      (l) => l.address.toLowerCase() === ADDRESSES.coinFlipGame.toLowerCase()
    );
    if (log && log.topics[1]) {
      roundId = log.topics[1] as `0x${string}`;
    }
  }

  return { createMatch, hash, isPending, isConfirming, isSuccess, roundId, error, reset };
}

export function useJoinMatch() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function joinMatch(roundId: `0x${string}`) {
    writeContract({
      address: ADDRESSES.coinFlipGame,
      abi: COINFLIP_ABI,
      functionName: "joinMatch",
      args: [roundId],
      ...AMOY_GAS,
    });
  }

  return { joinMatch, hash, isPending, isConfirming, isSuccess, error, reset };
}

export function useCancelMatch() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function cancelMatch(roundId: `0x${string}`) {
    writeContract({
      address: ADDRESSES.coinFlipGame,
      abi: COINFLIP_ABI,
      functionName: "cancelMatch",
      args: [roundId],
      ...AMOY_GAS,
    });
  }

  return { cancelMatch, hash, isPending, isConfirming, isSuccess, error };
}

export function useMatchData(roundId: `0x${string}` | undefined) {
  const { data, isLoading, refetch } = useReadContract({
    address: ADDRESSES.coinFlipGame,
    abi: COINFLIP_ABI,
    functionName: "getMatch",
    args: roundId ? [roundId] : undefined,
    query: {
      enabled: !!roundId,
      refetchInterval: (q) => {
        // Stop polling once settled (status === 2) or cancelled (status === 3)
        const status = (q.state.data as any)?.status;
        return status === 2 || status === 3 ? false : 3000;
      },
    },
  });

  return { match: data, isLoading, refetch };
}
