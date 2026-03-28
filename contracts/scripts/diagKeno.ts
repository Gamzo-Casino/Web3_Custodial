/**
 * Deep diagnostic for Keno VRF stuck issue.
 * Run: npx hardhat run scripts/diagKeno.ts --network amoy
 */

import { ethers } from "hardhat";

const RC_PROXY     = "0x5A8b5C504743b7cd4A26adED19B77bA5B0421B67";
const KENO_PROXY   = "0x44dC17d94345B4970caCecF7954AB676A25c6125";
const TREASURY     = "0xE74c5A5d10F5CcE18282Cd306AF207e0Fd310aAd";
const CORRECT_VRF  = "0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf2";
const GZO_TOKEN    = "0x43446C2FE00E94CF4aee508A64D301e90776F23E";

const GAME_ROLE    = ethers.keccak256(ethers.toUtf8Bytes("GAME_ROLE"));

const RC_ABI = [
  "function vrfCoordinator() view returns (address)",
  "function keyHash() view returns (bytes32)",
  "function subscriptionId() view returns (uint256)",
  "function callbackGas() view returns (uint32)",
  "function CALLBACK_GAS() view returns (uint32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

const TREASURY_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function totalLocked() view returns (uint256)",
  "function lockedByGame(bytes32) view returns (uint256)",
  "function paused() view returns (bool)",
  "function canPay(uint256) view returns (bool)",
];

const KENO_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function paused() view returns (bool)",
  "function minStake() view returns (uint256)",
  "function maxStake() view returns (uint256)",
  "function randomness() view returns (address)",
  "function treasury() view returns (address)",
];

const GZO_ABI = [
  "function balanceOf(address) view returns (uint256)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("\n══════════════════════════════════════════");
  console.log("  KENO VRF DIAGNOSTIC");
  console.log("══════════════════════════════════════════");
  console.log("Deployer:", deployer.address);

  const rc       = new ethers.Contract(RC_PROXY,   RC_ABI,       deployer);
  const keno     = new ethers.Contract(KENO_PROXY, KENO_ABI,     deployer);
  const treasury = new ethers.Contract(TREASURY,   TREASURY_ABI, deployer);
  const gzo      = new ethers.Contract(GZO_TOKEN,  GZO_ABI,      deployer);

  console.log("\n── RandomnessCoordinator ──────────────────");
  const vrfCoord    = await rc.vrfCoordinator();
  const keyHash     = await rc.keyHash();
  const subId       = await rc.subscriptionId();
  const callbackGas = await rc.callbackGas();
  const kenoHasGameRole = await rc.hasRole(GAME_ROLE, KENO_PROXY);

  const vrfOk = vrfCoord.toLowerCase() === CORRECT_VRF.toLowerCase();
  console.log(`  vrfCoordinator : ${vrfCoord} ${vrfOk ? "✓" : "✗ WRONG!"}`);
  console.log(`  keyHash        : ${keyHash}`);
  console.log(`  subscriptionId : ${subId.toString()}`);
  console.log(`  callbackGas    : ${callbackGas.toString()} ${callbackGas >= 1_000_000 ? "✓ (≥1M)" : "✗ TOO LOW!"}`);
  console.log(`  KENO GAME_ROLE : ${kenoHasGameRole ? "✓ granted" : "✗ MISSING!"}`);

  console.log("\n── KenoGame ───────────────────────────────");
  const kenoPaused     = await keno.paused();
  const kenoRandomness = await keno.randomness();
  const kenoTreasury   = await keno.treasury();
  const kenoMin        = await keno.minStake();
  const kenoMax        = await keno.maxStake();
  const rcOk = kenoRandomness.toLowerCase() === RC_PROXY.toLowerCase();
  const tvOk = kenoTreasury.toLowerCase() === TREASURY.toLowerCase();
  console.log(`  paused         : ${kenoPaused ? "✗ PAUSED!" : "✓ running"}`);
  console.log(`  randomness ptr : ${kenoRandomness} ${rcOk ? "✓" : "✗ MISMATCH!"}`);
  console.log(`  treasury ptr   : ${kenoTreasury} ${tvOk ? "✓" : "✗ MISMATCH!"}`);
  console.log(`  minStake       : ${ethers.formatEther(kenoMin)} GZO`);
  console.log(`  maxStake       : ${ethers.formatEther(kenoMax)} GZO`);

  console.log("\n── TreasuryVault ──────────────────────────");
  const tvPaused     = await treasury.paused();
  const tvLocked     = await treasury.totalLocked();
  const kenoGameId   = ethers.keccak256(ethers.toUtf8Bytes("KENO"));
  const kenoLocked   = await treasury.lockedByGame(kenoGameId);
  const tvBalance    = await gzo.balanceOf(TREASURY);
  const kenoGameRole = await treasury.hasRole(GAME_ROLE, KENO_PROXY);
  const freeBalance  = tvBalance > tvLocked ? tvBalance - tvLocked : 0n;
  const canPay10     = await treasury.canPay(ethers.parseEther("10"));

  console.log(`  paused         : ${tvPaused ? "✗ PAUSED!" : "✓ running"}`);
  console.log(`  GZO balance    : ${ethers.formatEther(tvBalance)} GZO`);
  console.log(`  totalLocked    : ${ethers.formatEther(tvLocked)} GZO`);
  console.log(`  kenoLocked     : ${ethers.formatEther(kenoLocked)} GZO`);
  console.log(`  freeBalance    : ${ethers.formatEther(freeBalance)} GZO`);
  console.log(`  canPay(10 GZO) : ${canPay10 ? "✓ yes" : "✗ NO!"}`);
  console.log(`  KENO GAME_ROLE : ${kenoGameRole ? "✓ granted" : "✗ MISSING!"}`);

  // ── Simulate fulfillRandomness ─────────────────────────────────
  console.log("\n── Gas Estimation (simulate fulfillRandomness) ────");
  const KENO_FULL_ABI = [
    "function fulfillRandomness(uint256 vrfRequestId, uint256[] memory randomWords) external",
    "function placeBet(uint256 stake, uint8[] calldata picks) external returns (bytes32)",
    "function vrfToRound(uint256) view returns (bytes32)",
    "function getRound(bytes32) view returns (address,uint256,uint8[],uint8[10],uint256,uint256,uint256,bool)",
  ];
  const kenoFull = new ethers.Contract(KENO_PROXY, KENO_FULL_ABI, deployer);

  // Check if there are any recent stuck rounds by checking lockedByGame
  if (kenoLocked > 0n) {
    console.log(`  NOTE: ${ethers.formatEther(kenoLocked)} GZO is locked in Keno — likely a stuck round`);
  } else {
    console.log(`  No locked stakes currently in Keno`);
  }

  // Try to estimate gas for a hypothetical fulfillRandomness call from RC perspective
  // We impersonate the RandomnessCoordinator to call fulfillRandomness
  console.log("\n── Summary ────────────────────────────────");
  const issues: string[] = [];
  if (!vrfOk) issues.push("vrfCoordinator address is WRONG");
  if (callbackGas < 1_000_000) issues.push(`callbackGas is only ${callbackGas} (need ≥1M)`);
  if (!kenoHasGameRole) issues.push("KenoGame missing GAME_ROLE on RandomnessCoordinator");
  if (!kenoGameRole) issues.push("KenoGame missing GAME_ROLE on TreasuryVault");
  if (kenoPaused) issues.push("KenoGame is PAUSED");
  if (tvPaused) issues.push("TreasuryVault is PAUSED");
  if (!rcOk) issues.push("KenoGame randomness pointer is wrong");
  if (!tvOk) issues.push("KenoGame treasury pointer is wrong");
  if (!canPay10) issues.push("Treasury cannot pay even 10 GZO!");

  if (issues.length === 0) {
    console.log("  ✓ All checks passed! Issue may be Chainlink VRF network delay.");
    console.log("  → Check Chainlink subscription at https://vrf.chain.link/");
    console.log("  → Verify consumer", RC_PROXY, "is registered and LINK balance > 0");
  } else {
    console.log("  ✗ FOUND ISSUES:");
    issues.forEach(i => console.log("    -", i));
  }
  console.log("══════════════════════════════════════════\n");
}

main().catch((err) => { console.error(err); process.exit(1); });
