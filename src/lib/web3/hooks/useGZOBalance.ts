"use client";

import { useReadContract, useAccount } from "wagmi";
import { formatEther } from "viem";
import { GZO_ABI, ADDRESSES } from "../contracts";

export function useGZOBalance() {
  const { address } = useAccount();

  const { data, isLoading, refetch } = useReadContract({
    address: ADDRESSES.gzoToken,
    abi: GZO_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  const raw = (data as bigint | undefined) ?? BigInt(0);

  return {
    raw,
    formatted: raw > BigInt(0)
      ? Number(formatEther(raw)).toLocaleString(undefined, { maximumFractionDigits: 2 })
      : "0",
    isLoading,
    refetch,
  };
}

export function useGZOAllowance(spender: `0x${string}`) {
  const { address } = useAccount();

  const { data, isLoading, refetch } = useReadContract({
    address: ADDRESSES.gzoToken,
    abi: GZO_ABI,
    functionName: "allowance",
    args: address ? [address, spender] : undefined,
    query: { enabled: !!address && !!spender, refetchInterval: 10_000 },
  });

  const raw = (data as bigint | undefined) ?? BigInt(0);

  return {
    raw,
    formatted: raw > BigInt(0)
      ? Number(formatEther(raw)).toLocaleString(undefined, { maximumFractionDigits: 2 })
      : "0",
    isLoading,
    refetch,
  };
}
