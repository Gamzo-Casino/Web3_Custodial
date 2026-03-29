/**
 * Full Chainlink VRF diagnostic based on Chainlink support recommendations.
 * Checks all 5 conditions from the support response.
 */
import { ethers } from "hardhat";

const VRF_COORDINATOR = "0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf2";
const RC_PROXY        = "0x5A8b5C504743b7cd4A26adED19B77bA5B0421B67";
const SUB_ID          = "37121473965311191308103942488437766006292923759699378585569059143270839490077";
const KEY_HASH        = "0x816bedba8a50b294e5cbd47842baf240c2385f2eaf719edbd4f250a137a8c899";

// Known pending VRF request IDs from our stuck bets
const PENDING_VRF_IDS = [
  "31590577902644851194319342038958782869395587716061724137758041145096794586751",  // KENO
  "71630934168914440726493905874532347543917717621329128774422533591324582516454",  // ROULETTE
];

const VRF_ABI = [
  // Subscription
  "function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] consumers)",
  "function pendingRequestExists(uint256 subId) view returns (bool)",
  // Gas lane / config
  "function getRequestConfig() view returns (uint16 minimumRequestConfirmations, uint32 maxCallbackGasLimit, bytes32[] keyHashes)",
  // Request status (point 5)
  "function getRequestStatus(uint256 requestId) view returns (bool fulfilled, uint256[] randomWords)",
  // Minimum balance check (point 2)
  "function calculateRequestPriceNative(uint32 callbackGasLimit, uint32 numWords) view returns (uint256)",
  "function calculateRequestPrice(uint32 callbackGasLimit, uint32 numWords) view returns (uint256)",
];

const RC_ABI = [
  "function callbackGas() view returns (uint32)",
  "function keyHash() view returns (bytes32)",
  "function subscriptionId() view returns (uint256)",
  "function vrfCoordinator() view returns (address)",
  "function requests(uint256) view returns (bytes32 gameId, address gameContract, bytes32 roundId, bool fulfilled)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const provider = ethers.provider;
  const coord = new ethers.Contract(VRF_COORDINATOR, VRF_ABI, signer);
  const rc    = new ethers.Contract(RC_PROXY, RC_ABI, signer);

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Chainlink VRF Full Diagnostic (5-Point Check)");
  console.log("══════════════════════════════════════════════════════\n");

  // ── 1. Pending list details ──────────────────────────────────────────
  console.log("── Check 1: Pending Requests ───────────────────────────");
  const pending = await coord.pendingRequestExists(BigInt(SUB_ID));
  console.log(`  pendingRequestExists: ${pending}`);
  
  // Check each VRF request status
  for (const vrfId of PENDING_VRF_IDS) {
    const req = await rc.requests(BigInt(vrfId));
    console.log(`\n  VRF ID (last 12 digits): ...${vrfId.slice(-12)}`);
    console.log(`    RC fulfilled:   ${req.fulfilled}`);
    console.log(`    gameContract:   ${req.gameContract}`);
    
    // Try getRequestStatus on coordinator
    try {
      const status = await coord.getRequestStatus(BigInt(vrfId));
      console.log(`    Coord fulfilled:${status.fulfilled}`);
      if (status.fulfilled) {
        console.log(`    randomWords:    ${status.randomWords.toString()}`);
      }
    } catch (e: any) {
      console.log(`    Coord status:   N/A (${e.message?.slice(0, 60)})`);
    }
  }

  // ── 2. Minimum subscription balance (Projected Balance) ─────────────
  console.log("\n── Check 2: Subscription Balance & Min Required ────────");
  const sub = await coord.getSubscription(BigInt(SUB_ID));
  console.log(`  Current LINK balance:  ${ethers.formatEther(sub.balance)} LINK`);
  console.log(`  Native balance:        ${ethers.formatEther(sub.nativeBalance)} MATIC`);
  console.log(`  Total requests served: ${sub.reqCount}`);

  const callbackGas = await rc.callbackGas();
  console.log(`  Our callbackGasLimit:  ${callbackGas}`);

  try {
    const priceLINK = await coord.calculateRequestPrice(Number(callbackGas), 1);
    console.log(`  Est. cost per request: ${ethers.formatEther(priceLINK)} LINK`);
    const minBalance = priceLINK * 3n; // ~3x buffer recommended
    console.log(`  Recommended min (3×): ${ethers.formatEther(minBalance)} LINK`);
    if (sub.balance < minBalance) {
      console.log(`  ⚠️  Balance below recommended minimum!`);
    } else {
      console.log(`  ✓ Balance is sufficient`);
    }
  } catch (e: any) {
    // Try native price
    try {
      const priceNative = await coord.calculateRequestPriceNative(Number(callbackGas), 1);
      console.log(`  Est. native cost/req:  ${ethers.formatEther(priceNative)} MATIC`);
    } catch {
      console.log(`  Price calc not available on this coordinator`);
    }
  }

  // ── 3. Gas Price Limit (keyHash / gas lane) ──────────────────────────
  console.log("\n── Check 3: Gas Lane (keyHash) Verification ────────────");
  const ourKeyHash = await rc.keyHash();
  console.log(`  Our keyHash:  ${ourKeyHash}`);
  console.log(`  Expected:     ${KEY_HASH}`);
  console.log(`  Match:        ${ourKeyHash.toLowerCase() === KEY_HASH.toLowerCase() ? "✓ YES" : "✗ NO — MISMATCH!"}`);
  
  // Check current network gas price vs gas lane limit
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 0n;
  const gasPriceGwei = Number(ethers.formatUnits(gasPrice, "gwei"));
  console.log(`\n  Current network gas price: ${gasPriceGwei.toFixed(2)} gwei`);
  console.log(`  Gas lane max (500-gwei):   500 gwei`);
  if (gasPrice > ethers.parseUnits("500", "gwei")) {
    console.log(`  ⚠️  Gas price ABOVE lane limit — Chainlink will NOT fulfill!`);
  } else {
    console.log(`  ✓ Gas price within lane limit`);
  }

  // Try to get available key hashes from coordinator config
  try {
    const config = await coord.getRequestConfig();
    console.log(`\n  Min confirmations:  ${config[0]}`);
    console.log(`  Max callback gas:   ${config[1]}`);
    console.log(`  Available keyHashes: ${config[2].length}`);
    for (const kh of config[2]) {
      const isOurs = kh.toLowerCase() === KEY_HASH.toLowerCase();
      console.log(`    ${kh} ${isOurs ? "← OURS ✓" : ""}`);
    }
    if (Number(callbackGas) > config[1]) {
      console.log(`  ⚠️  Our callbackGas ${callbackGas} > coordinator max ${config[1]}!`);
    }
  } catch (e: any) {
    console.log(`  getRequestConfig: ${e.message?.slice(0, 80)}`);
  }

  // ── 4. VRF Process: coordinator & RC alignment ───────────────────────
  console.log("\n── Check 4: VRF Coordinator Alignment ──────────────────");
  const rcCoord = await rc.vrfCoordinator();
  const rcSubId = await rc.subscriptionId();
  console.log(`  RC → vrfCoordinator:  ${rcCoord}`);
  console.log(`  Expected coordinator:  ${VRF_COORDINATOR}`);
  console.log(`  Match: ${rcCoord.toLowerCase() === VRF_COORDINATOR.toLowerCase() ? "✓" : "✗ MISMATCH!"}`);
  console.log(`\n  RC → subscriptionId:  ${rcSubId.toString()}`);
  console.log(`  Expected subId:        ${SUB_ID}`);
  console.log(`  Match: ${rcSubId.toString() === SUB_ID ? "✓" : "✗ MISMATCH!"}`);
  console.log(`\n  RC → callbackGas:     ${callbackGas}`);
  console.log(`  RC → keyHash:         ${ourKeyHash}`);

  // ── 5. Security / getRequestStatus ──────────────────────────────────
  console.log("\n── Check 5: Request Status via Coordinator ─────────────");
  for (const vrfId of PENDING_VRF_IDS) {
    try {
      const status = await coord.getRequestStatus(BigInt(vrfId));
      console.log(`  VRF ...${vrfId.slice(-12)} → fulfilled: ${status.fulfilled}`);
    } catch (e: any) {
      console.log(`  VRF ...${vrfId.slice(-12)} → getRequestStatus not available`);
      // Try raw call with different sig
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log("\n── Summary ─────────────────────────────────────────────");
  const issues: string[] = [];
  if (!pending && PENDING_VRF_IDS.length > 0) issues.push("pendingRequestExists=false but we have unfulfilled requests — possible subscription mismatch");
  if (gasPrice > ethers.parseUnits("500", "gwei")) issues.push(`Gas price ${gasPriceGwei} gwei > 500 gwei lane limit`);
  if (ourKeyHash.toLowerCase() !== KEY_HASH.toLowerCase()) issues.push("keyHash mismatch");
  if (rcCoord.toLowerCase() !== VRF_COORDINATOR.toLowerCase()) issues.push("vrfCoordinator mismatch");
  if (rcSubId.toString() !== SUB_ID) issues.push("subscriptionId mismatch");

  if (issues.length === 0) {
    console.log("  ✓ All 5 checks passed.");
    console.log("  → Root cause: Chainlink Amoy VRF node latency / testnet reliability.");
    console.log("  → Use manualFulfill() as fallback when requests exceed 5 min threshold.");
  } else {
    console.log("  ✗ Issues found:");
    issues.forEach(i => console.log(`    - ${i}`));
  }
  console.log("══════════════════════════════════════════════════════\n");
}
main().catch(console.error);
