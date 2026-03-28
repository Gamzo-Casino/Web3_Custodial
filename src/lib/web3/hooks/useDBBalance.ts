"use client";

import { useState, useEffect, useCallback } from "react";

export function useDBBalance() {
  const [balance, setBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet/balance");
      if (res.ok) {
        const data = await res.json();
        setBalance(data.balance ?? 0);
      }
    } catch {
      // Silently fail — stale value is acceptable
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    const id = setInterval(refetch, 10_000);
    return () => clearInterval(id);
  }, [refetch]);

  const formatted =
    balance > 0
      ? balance.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : "0";

  return { balance, formatted, isLoading, refetch };
}
