/**
 * Dev-only hook: while `active` is true, polls /api/dev/fulfill-vrf every 2 s
 * so Chainlink VRF requests on the local Hardhat network get fulfilled automatically.
 * Does nothing in production (chainId != 31337).
 */
import { useEffect, useRef } from "react";
import deployedAddresses from "@/lib/web3/deployed-addresses.json";

const IS_LOCAL = Number(deployedAddresses.chainId) === 31337;
const POLL_MS = 2000;

export function useVRFAutoFulfill(active: boolean) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!IS_LOCAL || !active) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    async function fulfill() {
      try {
        await fetch("/api/dev/fulfill-vrf", { method: "POST" });
      } catch {
        // silently ignore network errors
      }
    }

    // Trigger immediately, then on interval
    fulfill();
    timerRef.current = setInterval(fulfill, POLL_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [active]);
}
