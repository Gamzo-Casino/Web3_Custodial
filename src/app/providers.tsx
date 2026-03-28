"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme, type Theme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/web3/config";
import { type ReactNode, useState } from "react";
import { WalletAuthProvider } from "@/contexts/WalletAuthContext";

// Gamzo dark theme override
const gamzoTheme: Theme = {
  ...darkTheme({
    accentColor: "#00ff9d",
    accentColorForeground: "#0a0a1a",
    borderRadius: "medium",
    fontStack: "system",
    overlayBlur: "small",
  }),
  colors: {
    ...darkTheme().colors,
    modalBackground: "#0d0d1f",
    modalBorder: "#2a2a50",
    profileAction: "#1a1a35",
    profileActionHover: "#252550",
    generalBorder: "#2a2a50",
    generalBorderDim: "#1a1a30",
    actionButtonBorder: "#2a2a50",
    actionButtonBorderMobile: "#2a2a50",
    connectButtonBackground: "#0d0d1f",
    connectButtonBackgroundError: "#1a0a0a",
    connectButtonInnerBackground: "linear-gradient(135deg, #00ff9d22 0%, #00d4ff22 100%)",
    connectButtonText: "#00ff9d",
    connectButtonTextError: "#ff8080",
    menuItemBackground: "#1a1a35",
    selectedOptionBorder: "#00ff9d44",
    standby: "#ffd700",
  },
};

export function Web3Providers({ children }: { children: ReactNode }) {
  // Create a new QueryClient per component instance to avoid sharing state
  // between server and client renders (prevents SSR hydration mismatches).
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      })
  );

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount={true}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider theme={gamzoTheme} modalSize="compact">
          <WalletAuthProvider>
            {children}
          </WalletAuthProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
