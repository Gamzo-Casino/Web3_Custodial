/**
 * Prisma seed script — syncs House Treasury balance from the on-chain GZO balance
 * of the house deposit wallet (NEXT_PUBLIC_HOUSE_DEPOSIT_ADDRESS).
 *
 * Run:  npx tsx prisma/seed.ts
 *
 * Safe to re-run: always reads the live on-chain balance and updates the DB row.
 */

import "dotenv/config";
import { createPublicClient, http, formatEther } from "viem";
import { polygonAmoy } from "viem/chains";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const HOUSE_ID = "house";
const GZO_TOKEN = "0x43446C2FE00E94CF4aee508A64D301e90776F23E" as const;
const GZO_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

async function fetchOnChainBalance(houseAddress: string): Promise<number> {
  const rpc =
    process.env.SERVER_RPC_URL ?? "https://rpc-amoy.polygon.technology";
  const client = createPublicClient({
    chain: polygonAmoy,
    transport: http(rpc),
  });

  const raw = await client.readContract({
    address: GZO_TOKEN,
    abi: GZO_ABI,
    functionName: "balanceOf",
    args: [houseAddress as `0x${string}`],
  });

  return Number(formatEther(raw as bigint));
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const houseAddress = process.env.NEXT_PUBLIC_HOUSE_DEPOSIT_ADDRESS;
  if (!houseAddress) throw new Error("NEXT_PUBLIC_HOUSE_DEPOSIT_ADDRESS is not set");

  console.log(`House wallet: ${houseAddress}`);

  // Fetch live on-chain balance
  console.log("Fetching on-chain GZO balance…");
  const onChainBalance = await fetchOnChainBalance(houseAddress);
  console.log(`On-chain balance: ${onChainBalance.toLocaleString()} GZO`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new PrismaPg({ connectionString });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = new (PrismaClient as any)({ adapter }) as any;

  try {
    await prisma.$transaction(async (tx: any) => {
      const existing = await tx.houseTreasury.findUnique({
        where: { id: HOUSE_ID },
      });

      const prevBalance = existing ? Number(existing.balanceGzo) : 0;

      if (existing) {
        await tx.houseTreasury.update({
          where: { id: HOUSE_ID },
          data: { balanceGzo: String(onChainBalance) },
        });
      } else {
        await tx.houseTreasury.create({
          data: { id: HOUSE_ID, balanceGzo: String(onChainBalance) },
        });
      }

      await tx.houseLedger.create({
        data: {
          houseId: HOUSE_ID,
          type: "INITIAL_FUND",
          amountGzo: String(onChainBalance),
          balanceBefore: String(prevBalance),
          balanceAfter: String(onChainBalance),
          reference: "sync-from-chain",
        },
      });
    });

    console.log(
      `Treasury set to ${onChainBalance.toLocaleString()} GZO (synced from chain)`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
