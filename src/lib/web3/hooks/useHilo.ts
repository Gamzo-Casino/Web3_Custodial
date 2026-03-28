"use client";

import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { useAccount } from "wagmi";
import { HILO_ABI, ADDRESSES } from "../contracts";
import { AMOY_GAS } from "../gasConfig";
export function useStartHiloRound() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  function startRound(stakeWei: bigint) {
    writeContract({
      address: ADDRESSES.hiloGame,
      abi: HILO_ABI,
      functionName: "startRound",
      args: [stakeWei],
      ...AMOY_GAS,
    });
  }

  let roundId: `0x${string}` | undefined;
  if (receipt) {
    const log = receipt.logs.find(
      (l) => l.address.toLowerCase() === ADDRESSES.hiloGame.toLowerCase()
    );
    if (log && log.topics[1]) roundId = log.topics[1] as `0x${string}`;
  }

  return { startRound, hash, isPending, isConfirming, isSuccess, roundId, error, reset };
}

export function useHiloCashout() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function cashout(
    roundId: `0x${string}`,
    cards: number[],
    positions: number[],
    guesses: number[],
    cashoutAt: bigint,
  ) {
    writeContract({
      address: ADDRESSES.hiloGame,
      abi: HILO_ABI,
      functionName: "cashout",
      args: [roundId, cards, positions, guesses, cashoutAt],
      ...AMOY_GAS,
    });
  }

  return { cashout, hash, isPending, isConfirming, isSuccess, error, reset };
}

export function useHiloLose() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function loseRound(
    roundId: `0x${string}`,
    cards: number[],
    positions: number[],
    guesses: number[],
    lostAtStep: bigint,
  ) {
    writeContract({
      address: ADDRESSES.hiloGame,
      abi: HILO_ABI,
      functionName: "loseRound",
      args: [roundId, cards, positions, guesses, lostAtStep],
      ...AMOY_GAS,
    });
  }

  return { loseRound, hash, isPending, isConfirming, isSuccess, error, reset };
}

export function useHiloRound(roundId: `0x${string}` | undefined) {
  const { data, isLoading, refetch } = useReadContract({
    address: ADDRESSES.hiloGame,
    abi: HILO_ABI,
    functionName: "getRound",
    args: roundId ? [roundId] : undefined,
    query: {
      enabled: !!roundId,
      // Poll until status >= 2 (CASHED_OUT=2, LOST=3, REFUNDED=4)
      refetchInterval: (q) => {
        const status = (q.state.data as any)?.status;
        return status >= 2 ? false : 3000;
      },
    },
  });
  return { round: data, isLoading, refetch };
}

export function useActiveHiloRound() {
  const { address } = useAccount();
  const { data: activeRoundId, isLoading } = useReadContract({
    address: ADDRESSES.hiloGame,
    abi: HILO_ABI,
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

export function useHiloDeckOrder(roundId: `0x${string}` | undefined, deckReady: boolean) {
  const { data, isLoading } = useReadContract({
    address: ADDRESSES.hiloGame,
    abi: HILO_ABI,
    functionName: "getDeckOrder",
    args: roundId ? [roundId] : undefined,
    query: { enabled: !!roundId && deckReady },
  });
  return { deck: data as number[] | undefined, isLoading };
}
