import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/NavBar";
import SessionProvider from "@/components/SessionProvider";
import { Web3Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gamzo — Provably Fair Games",
  description: "Gamzo: play provably fair coinflip and more.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <Web3Providers>
        <SessionProvider>
          <NavBar />
          <main
            style={{
              maxWidth: "1280px",
              margin: "0 auto",
              padding: "2rem 1.5rem",
            }}
          >
            {children}
          </main>
        </SessionProvider>
        </Web3Providers>
      </body>
    </html>
  );
}
