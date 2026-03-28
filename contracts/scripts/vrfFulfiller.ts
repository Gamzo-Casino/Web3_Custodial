/**
 * Local VRF Auto-Fulfiller
 * Watches for RandomnessRequested events from RandomnessCoordinator and
 * automatically calls MockVRFCoordinator.fulfillRandomWords() with a random value.
 *
 * Run alongside the dev server:
 *   npx hardhat run scripts/vrfFulfiller.ts --network localhost
 */
import { ethers } from "hardhat";
import * as addresses from "../../src/lib/web3/deployed-addresses.json";

// ABI fragments we need
const COORDINATOR_ABI = [
  "event RandomnessRequested(uint256 indexed vrfRequestId, bytes32 indexed gameId, bytes32 indexed roundId)",
];

const MOCK_VRF_ABI = [
  "function fulfillRandomWords(uint256 requestId, address coordinator, uint256 randomWord) external",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const provider = ethers.provider;

  const coordinator = new ethers.Contract(
    addresses.randomnessCoordinator,
    COORDINATOR_ABI,
    signer
  );

  const mockVRF = new ethers.Contract(
    addresses.mockVRFCoordinator,
    MOCK_VRF_ABI,
    signer
  );

  console.log("═══════════════════════════════════════════");
  console.log("  VRF Auto-Fulfiller (local only)");
  console.log("  RandomnessCoordinator:", addresses.randomnessCoordinator);
  console.log("  MockVRFCoordinator:   ", addresses.mockVRFCoordinator);
  console.log("  Signer:               ", signer.address);
  console.log("  Listening for VRF requests…");
  console.log("═══════════════════════════════════════════");

  // Listen for new events
  coordinator.on("RandomnessRequested", async (vrfRequestId: bigint, gameId: string, roundId: string) => {
    console.log(`\n[VRF] Request #${vrfRequestId} for game ${gameId.slice(0, 10)}… round ${roundId.slice(0, 10)}…`);

    // Wait 1 block so the tx that emitted this is confirmed
    await provider.send("evm_mine", []);

    // Generate a pseudo-random word (good enough for local dev)
    const randomWord = BigInt(
      "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")
    );

    try {
      const tx = await mockVRF.fulfillRandomWords(
        vrfRequestId,
        addresses.randomnessCoordinator,
        randomWord
      );
      await tx.wait();
      console.log(`[VRF] ✓ Fulfilled request #${vrfRequestId} with randomWord ${randomWord.toString().slice(0, 20)}…`);
    } catch (err: any) {
      console.error(`[VRF] ✗ Failed to fulfill #${vrfRequestId}:`, err.message);
    }
  });

  // Also catch-up on any pending unfulfilled requests from the past
  // (in case games were started before the fulfiller launched)
  console.log("\n[VRF] Scanning past events…");
  const filter = coordinator.filters.RandomnessRequested();
  const pastEvents = await coordinator.queryFilter(filter, 0, "latest");
  console.log(`[VRF] Found ${pastEvents.length} past VRF request(s)`);

  // Keep the process alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
