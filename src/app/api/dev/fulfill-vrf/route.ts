/**
 * DEV-ONLY: Auto-fulfill pending VRF requests on the local Hardhat network.
 *
 * Called by game pages while they're in "waiting for VRF" state.
 * Uses Hardhat account #0 (well-known dev private key) to call
 * MockVRFCoordinator.fulfillRandomWords() for every pending request.
 *
 * POST /api/dev/fulfill-vrf
 */

import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import addresses from "@/lib/web3/deployed-addresses.json";

// Only active in local dev (chainId 31337)
const IS_LOCAL = Number(addresses.chainId) === 31337;

// Hardhat account #0 — well-known dev key, never used in production
const DEV_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const MOCK_VRF_ABI = [
  {
    name: "fulfillRandomWords",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "coordinator", type: "address" },
      { name: "randomWord", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "requests",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [
      { name: "requester", type: "address" },
      { name: "fulfilled", type: "bool" },
    ],
  },
] as const;

function randomWord(): bigint {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("crypto") as typeof import("crypto");
  const bytes = new Uint8Array(32);
  crypto.randomFillSync(bytes);
  return BigInt("0x" + Buffer.from(bytes).toString("hex"));
}

export async function POST() {
  if (!IS_LOCAL) {
    return NextResponse.json(
      { error: "VRF auto-fulfillment is only available on local Hardhat network" },
      { status: 403 }
    );
  }

  try {
    const account = privateKeyToAccount(DEV_PRIVATE_KEY);

    const publicClient: PublicClient = createPublicClient({
      chain: hardhat,
      transport: http("http://127.0.0.1:8545"),
    });

    const walletClient = createWalletClient({
      chain: hardhat,
      transport: http("http://127.0.0.1:8545"),
      account,
    });

    // Mine a block first so any pending txs are confirmed before reading logs
    await publicClient.request({ method: "evm_mine" as any, params: [] as any });

    // Get all RandomnessRequested events from the coordinator
    const logs = await publicClient.getLogs({
      address: addresses.randomnessCoordinator as `0x${string}`,
      event: parseAbiItem(
        "event RandomnessRequested(uint256 indexed vrfRequestId, bytes32 indexed gameId, bytes32 indexed roundId)"
      ),
      fromBlock: 0n,
      toBlock: "latest",
    });

    const fulfilled: number[] = [];
    const skipped: number[] = [];
    const failed: string[] = [];

    for (const log of logs) {
      const vrfRequestId = log.args.vrfRequestId as bigint;

      // Check on-chain if this request is already fulfilled — skip if so
      try {
        const reqData = await publicClient.readContract({
          address: (addresses as any).mockVRFCoordinator as `0x${string}`,
          abi: MOCK_VRF_ABI,
          functionName: "requests",
          args: [vrfRequestId],
        });
        if ((reqData as any)[1] === true) {
          skipped.push(Number(vrfRequestId));
          continue;
        }
      } catch {
        // If we can't read, try to fulfill anyway
      }

      // This request is pending — try to fulfill it
      try {
        const hash = await walletClient.writeContract({
          address: (addresses as any).mockVRFCoordinator as `0x${string}`,
          abi: MOCK_VRF_ABI,
          functionName: "fulfillRandomWords",
          args: [vrfRequestId, addresses.randomnessCoordinator as `0x${string}`, randomWord()],
        });
        await publicClient.waitForTransactionReceipt({ hash });
        fulfilled.push(Number(vrfRequestId));
      } catch (err: any) {
        const msg = err?.shortMessage ?? err?.message ?? String(err);
        console.error(`[fulfill-vrf] Failed to fulfill #${vrfRequestId}:`, msg);
        failed.push(`#${vrfRequestId}: ${msg.slice(0, 120)}`);
      }
    }

    return NextResponse.json({
      ok: true,
      total: logs.length,
      fulfilled,
      skipped: skipped.length,
      failed,
    });
  } catch (err: any) {
    console.error("[fulfill-vrf]", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
