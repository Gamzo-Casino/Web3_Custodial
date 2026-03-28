"use client";

import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { useAccount } from "wagmi";
import { MINES_ABI, ADDRESSES } from "../contracts";
import { AMOY_GAS } from "../gasConfig";
export function useStartMinesRound() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  function startRound(stakeWei: bigint, mineCount: number) {
    writeContract({
      address: ADDRESSES.minesGame,
      abi: MINES_ABI,
      functionName: "startRound",
      args: [stakeWei, mineCount],
      ...AMOY_GAS,
    });
  }

  let roundId: `0x${string}` | undefined;
  if (receipt) {
    const log = receipt.logs.find(
      (l) => l.address.toLowerCase() === ADDRESSES.minesGame.toLowerCase()
    );
    if (log && log.topics[1]) roundId = log.topics[1] as `0x${string}`;
  }

  return { startRound, hash, isPending, isConfirming, isSuccess, roundId, error, reset };
}

export function useMinesCashout() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function cashout(roundId: `0x${string}`, revealedTiles: number[]) {
    writeContract({
      address: ADDRESSES.minesGame,
      abi: MINES_ABI,
      functionName: "cashout",
      args: [roundId, revealedTiles],
      ...AMOY_GAS,
    });
  }

  return { cashout, hash, isPending, isConfirming, isSuccess, error, reset };
}

export function useMinesLose() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function loseRound(roundId: `0x${string}`, hitTile: number) {
    writeContract({
      address: ADDRESSES.minesGame,
      abi: MINES_ABI,
      functionName: "loseRound",
      args: [roundId, hitTile],
      ...AMOY_GAS,
    });
  }

  return { loseRound, hash, isPending, isConfirming, isSuccess, error, reset };
}

export function useMinesRound(roundId: `0x${string}` | undefined) {
  const { data, isLoading, refetch } = useReadContract({
    address: ADDRESSES.minesGame,
    abi: MINES_ABI,
    functionName: "getRound",
    args: roundId ? [roundId] : undefined,
    query: {
      enabled: !!roundId,
      // Poll until settled (status 2=CASHED_OUT, 3=LOST, 4=REFUNDED)
      refetchInterval: (q) => {
        const status = (q.state.data as any)?.status;
        return status >= 2 ? false : 3000;
      },
    },
  });
  return { round: data, isLoading, refetch };
}

export function useActiveMinesRound() {
  const { address } = useAccount();
  const { data: activeRoundId, isLoading } = useReadContract({
    address: ADDRESSES.minesGame,
    abi: MINES_ABI,
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

export function useMinePositions(roundId: `0x${string}` | undefined, vrfReady: boolean) {
  const { data, isLoading } = useReadContract({
    address: ADDRESSES.minesGame,
    abi: MINES_ABI,
    functionName: "getMinePositions",
    args: roundId ? [roundId] : undefined,
    query: { enabled: !!roundId && vrfReady },
  });
  return { minePositions: data as number[] | undefined, isLoading };
}
