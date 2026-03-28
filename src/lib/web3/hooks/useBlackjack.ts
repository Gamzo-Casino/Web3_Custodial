"use client";

import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { useAccount } from "wagmi";
import { BLACKJACK_ABI, ADDRESSES } from "../contracts";
import { AMOY_GAS } from "../gasConfig";
export function useStartBlackjackRound() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  function startRound(stakeWei: bigint) {
    writeContract({
      address: ADDRESSES.blackjackGame,
      abi: BLACKJACK_ABI,
      functionName: "startRound",
      args: [stakeWei],
      ...AMOY_GAS,
    });
  }

  let roundId: `0x${string}` | undefined;
  if (receipt) {
    const log = receipt.logs.find(
      (l) => l.address.toLowerCase() === ADDRESSES.blackjackGame.toLowerCase()
    );
    if (log && log.topics[1]) roundId = log.topics[1] as `0x${string}`;
  }

  return { startRound, hash, isPending, isConfirming, isSuccess, roundId, error, reset };
}

export function useBlackjackLockDouble() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function lockDouble(roundId: `0x${string}`) {
    writeContract({
      address: ADDRESSES.blackjackGame,
      abi: BLACKJACK_ABI,
      functionName: "lockDouble",
      args: [roundId],
      ...AMOY_GAS,
    });
  }

  return { lockDouble, hash, isPending, isConfirming, isSuccess, error, reset };
}

export function useBlackjackLockSplit() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function lockSplit(roundId: `0x${string}`) {
    writeContract({
      address: ADDRESSES.blackjackGame,
      abi: BLACKJACK_ABI,
      functionName: "lockSplit",
      args: [roundId],
      ...AMOY_GAS,
    });
  }

  return { lockSplit, hash, isPending, isConfirming, isSuccess, error, reset };
}

export function useBlackjackSettle() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function settleRound(
    roundId: `0x${string}`,
    playerCards: number[],
    dealerCards: number[],
    playerPositions: number[],
    dealerPositions: number[],
    splitCards: number[],
    splitPositions: number[],
    didDouble: boolean,
  ) {
    writeContract({
      address: ADDRESSES.blackjackGame,
      abi: BLACKJACK_ABI,
      functionName: "settleRound",
      args: [roundId, playerCards, dealerCards, playerPositions, dealerPositions, splitCards, splitPositions, didDouble],
      ...AMOY_GAS,
    });
  }

  return { settleRound, hash, isPending, isConfirming, isSuccess, error, reset };
}

export function useBlackjackRound(roundId: `0x${string}` | undefined) {
  const { data, isLoading, refetch } = useReadContract({
    address: ADDRESSES.blackjackGame,
    abi: BLACKJACK_ABI,
    functionName: "getRound",
    args: roundId ? [roundId] : undefined,
    query: {
      enabled: !!roundId,
      // Poll until status >= 2 (SETTLED=2, REFUNDED=3)
      refetchInterval: (q) => {
        const status = (q.state.data as any)?.status;
        return status >= 2 ? false : 3000;
      },
    },
  });
  return { round: data, isLoading, refetch };
}

export function useActiveBlackjackRound() {
  const { address } = useAccount();
  const { data: activeRoundId, isLoading } = useReadContract({
    address: ADDRESSES.blackjackGame,
    abi: BLACKJACK_ABI,
    functionName: "activeRound",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });
  return {
    activeRoundId: activeRoundId as `0x${string}` | undefined,
    hasActiveRound: activeRoundId !== "0x0000000000000000000000000000000000000000000000000000000000000000",
    isLoading,
  };
}

export function useBlackjackDeckOrder(roundId: `0x${string}` | undefined, deckReady: boolean) {
  const { data, isLoading } = useReadContract({
    address: ADDRESSES.blackjackGame,
    abi: BLACKJACK_ABI,
    functionName: "getDeckOrder",
    args: roundId ? [roundId] : undefined,
    query: { enabled: !!roundId && deckReady },
  });
  return { deck: data as number[] | undefined, isLoading };
}
