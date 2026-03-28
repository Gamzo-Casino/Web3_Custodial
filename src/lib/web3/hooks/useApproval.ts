"use client";

import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { maxUint256 } from "viem";
import { GZO_ABI, ADDRESSES } from "../contracts";
import { useGZOAllowance } from "./useGZOBalance";
import { AMOY_GAS } from "../gasConfig";

export function useApproveGZO(spender: `0x${string}`) {
  const { raw: allowance, refetch: refetchAllowance } = useGZOAllowance(spender);

  const { writeContract, data: hash, isPending, error } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // Refetch allowance after confirmation
  if (isSuccess) { refetchAllowance(); }

  function approve(amount?: bigint) {
    writeContract({
      address: ADDRESSES.gzoToken,
      abi: GZO_ABI,
      functionName: "approve",
      args: [spender, amount ?? maxUint256],
      ...AMOY_GAS,
    });
  }

  function needsApproval(requiredAmount: bigint) {
    return allowance < requiredAmount;
  }

  return {
    approve,
    needsApproval,
    allowance,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error: error as Error | null,
  };
}

export function useFaucet() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function claimFaucet() {
    writeContract({
      address: ADDRESSES.gzoToken,
      abi: GZO_ABI,
      functionName: "faucet",
      args: [],
      ...AMOY_GAS,
    });
  }

  return { claimFaucet, hash, isPending, isConfirming, isSuccess, error: error as Error | null };
}
