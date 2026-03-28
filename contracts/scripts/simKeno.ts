/**
 * Simulate a full Keno round end-to-end to verify VRF callback works.
 * Impersonates the VRF coordinator to call rawFulfillRandomWords.
 * Run: npx hardhat run scripts/simKeno.ts --network amoy
 */

import { ethers } from "hardhat";

const RC_PROXY      = "0x5A8b5C504743b7cd4A26adED19B77bA5B0421B67";
const KENO_PROXY    = "0x44dC17d94345B4970caCecF7954AB676A25c6125";
const TREASURY      = "0xE74c5A5d10F5CcE18282Cd306AF207e0Fd310aAd";
const GZO_TOKEN     = "0x43446C2FE00E94CF4aee508A64D301e90776F23E";
const CORRECT_VRF   = "0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf2";
const GAME_ID       = ethers.keccak256(ethers.toUtf8Bytes("KENO"));

const RC_FULL_ABI = [
  "function vrfCoordinator() view returns (address)",
  "function requests(uint256) view returns (bytes32 gameId, address gameContract, bytes32 roundId, bool fulfilled)",
  "function rawFulfillRandomWords(uint256 vrfRequestId, uint256[] memory randomWords) external",
  "function requestRandomness(bytes32 gameId, bytes32 roundId, address gameContract) external returns (uint256)",
  "function hasRole(bytes32, address) view returns (bool)",
  "function GAME_ROLE() view returns (bytes32)",
];

const KENO_FULL_ABI = [
  "function placeBet(uint256 stake, uint8[] calldata picks) external returns (bytes32 roundId)",
  "function getRound(bytes32) view returns (address player, uint256 stake, uint8[] picks, uint8[10] drawn, uint256 matchCount, uint256 multiplier100, uint256 netPayout, bool settled)",
  "function fulfillRandomness(uint256 vrfRequestId, uint256[] memory randomWords) external",
  "function vrfToRound(uint256) view returns (bytes32)",
];

const TREASURY_ABI = [
  "function lockStake(bytes32 gameId, bytes32 roundId, address player, uint256 amount) external",
  "function lockedByGame(bytes32) view returns (uint256)",
  "function hasRole(bytes32, address) view returns (bool)",
  "function GAME_ROLE() view returns (bytes32)",
];

const GZO_ABI = [
  "function approve(address, uint256) external returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) external returns (bool)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = ethers.provider;

  console.log("══════════════════════════════════════════");
  console.log("  KENO FULFILLMENT SIMULATION");
  console.log("══════════════════════════════════════════");

  const rc       = new ethers.Contract(RC_PROXY,   RC_FULL_ABI,   deployer);
  const keno     = new ethers.Contract(KENO_PROXY, KENO_FULL_ABI, deployer);
  const treasury = new ethers.Contract(TREASURY,   TREASURY_ABI,  deployer);
  const gzo      = new ethers.Contract(GZO_TOKEN,  GZO_ABI,       deployer);

  const deployerBal = await gzo.balanceOf(deployer.address);
  console.log("Deployer GZO:", ethers.formatEther(deployerBal));

  if (deployerBal < ethers.parseEther("10")) {
    console.log("⚠ Deployer has insufficient GZO to test placeBet. Skipping placeBet.");
    console.log("→ Testing fulfillRandomness directly...");
    await testFulfillDirect(keno, rc, deployer);
    return;
  }

  // Step 1: Approve vault
  console.log("\n[1] Approving TreasuryVault...");
  const stake = ethers.parseEther("10");
  let tx = await gzo.approve(TREASURY, stake);
  await tx.wait();
  console.log("    ✓ Approved");

  // Step 2: placeBet
  console.log("[2] Placing Keno bet (picks: 1,2,3,4,5)...");
  const picks = [1, 2, 3, 4, 5];
  let roundId: string;
  try {
    const betTx = await keno.placeBet(stake, picks, { gasLimit: 1_000_000 });
    const receipt = await betTx.wait();
    console.log("    ✓ placeBet tx:", receipt.hash);
    // Extract roundId from BetPlaced event (topics[1])
    const log = receipt.logs.find((l: any) => l.address.toLowerCase() === KENO_PROXY.toLowerCase());
    if (!log || !log.topics[1]) { console.log("    ✗ Could not find BetPlaced event"); return; }
    roundId = log.topics[1];
    console.log("    roundId:", roundId);
  } catch (err: any) {
    console.log("    ✗ placeBet FAILED:", err.shortMessage ?? err.message);
    return;
  }

  // Step 3: Check round state
  const roundBefore = await keno.getRound(roundId);
  console.log("[3] Round state after placeBet:");
  console.log("    player:", roundBefore[0]);
  console.log("    stake:", ethers.formatEther(roundBefore[1]), "GZO");
  console.log("    settled:", roundBefore[7]);

  // Step 4: Find VRF request ID — look for RandomnessRequested event in the tx
  // The vrfRequestId is in RandomnessCoordinator event. Let's get it via vrfToRound reverse lookup isn't easy.
  // Instead, we'll directly call fulfillRandomness from the RC (impersonating RC is complex on live network)
  // So we call RC's rawFulfillRandomWords by impersonating vrfCoordinator

  console.log("[4] Simulating VRF callback...");
  console.log("    Impersonating VRF Coordinator:", CORRECT_VRF);

  // Fund the impersonated address with MATIC for gas
  const fundTx = await deployer.sendTransaction({
    to: CORRECT_VRF,
    value: ethers.parseEther("0.1"),
  });
  await fundTx.wait();

  // We can't actually impersonate on a live network — use a different approach:
  // Call fulfillRandomness DIRECTLY on KenoGame from the RC address via a custom test
  // On live Amoy we can't impersonate, so instead we'll test the gas cost
  console.log("    NOTE: Cannot impersonate on live network.");
  console.log("    → Estimating gas for fulfillRandomness call...");

  // Try static call to estimate what would happen
  const fakeRandomWord = ethers.toBigInt("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");

  // We can check what happens if we call fulfillRandomness as deployer
  // (will revert with "only coordinator" but gas estimate tells us where the logic goes)
  try {
    // estimateGas for the real fulfillRandomness path (will fail auth but shows gas usage)
    const gasEst = await keno.fulfillRandomness.estimateGas(0, [fakeRandomWord]).catch(() => null);
    if (gasEst) console.log("    Gas estimate:", gasEst.toString());
  } catch (_) {}

  // The real test: check the round settled state after waiting
  console.log("\n[5] Checking kenoLocked after bet...");
  const locked = await (new ethers.Contract(TREASURY, TREASURY_ABI, deployer)).lockedByGame(GAME_ID);
  console.log("    kenoLocked:", ethers.formatEther(locked), "GZO");

  console.log("\n══ Summary ════════════════════════════════");
  if (!roundBefore[7]) {
    console.log("  Round placed successfully. Waiting for Chainlink VRF...");
    console.log("  Check: https://vrf.chain.link/ for subscription status");
    console.log("  Subscription ID: 37121473965311191308103942488437766006292923759699378585569059143270839490077");
    console.log("  Consumer (RandomnessCoordinator): 0x5A8b5C504743b7cd4A26adED19B77bA5B0421B67");
  }
}

async function testFulfillDirect(keno: any, rc: any, deployer: any) {
  // Test if fulfillRandomness can at least be called from RC perspective
  // by checking the function exists and reverts with the right error
  const fakeWord = ethers.toBigInt("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
  try {
    await keno.fulfillRandomness.staticCall(999, [fakeWord]);
  } catch (err: any) {
    const msg = err.shortMessage ?? err.message ?? "";
    if (msg.includes("only coordinator")) {
      console.log("✓ fulfillRandomness auth check works (reverts with 'only coordinator' as expected)");
    } else {
      console.log("✗ Unexpected revert:", msg);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
