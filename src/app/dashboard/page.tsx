"use client";

import { useWalletUser } from "@/contexts/WalletAuthContext";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import GamesGrid from "@/components/GamesGrid";
import GZOBalanceCard from "@/components/GZOBalanceCard";
import DepositWithdrawPanel from "@/components/DepositWithdrawPanel";
import WalletTransactions from "@/components/WalletTransactions";

export default function DashboardPage() {
  const { user, isLoading } = useWalletUser();
  const { isConnected } = useAccount();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isConnected && !user) {
      router.push("/");
    }
  }, [isLoading, isConnected, user, router]);

  const displayName = user?.name ?? (user?.walletAddress
    ? `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)}`
    : null);

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "0 1rem" }}>
      {/* Page header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1
          style={{
            fontSize: "1.875rem",
            fontWeight: 800,
            letterSpacing: "-0.5px",
            marginBottom: "0.25rem",
          }}
        >
          Dashboard
        </h1>
        <p style={{ color: "#8888aa", fontSize: "0.9rem" }}>
          {displayName ? (
            <>
              Welcome back,{" "}
              <span style={{ color: "#f0f0ff", fontWeight: 600 }}>{displayName}</span>
            </>
          ) : (
            "Connect your wallet to start playing"
          )}
        </p>
      </div>

      {/* Custodial GZO balance card */}
      <GZOBalanceCard />

      {/* Deposit & Withdraw */}
      <DepositWithdrawPanel />

      {/* Games grid */}
      <GamesGrid />

      {/* Transaction history */}
      <WalletTransactions />
    </div>
  );
}
