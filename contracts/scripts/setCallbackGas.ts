/**
 * Reduce RandomnessCoordinator callbackGas from 1,000,000 → 500,000.
 *
 * Root cause of stuck VRF requests:
 *   - upgradeCoordinator.ts set callbackGas = 1,000,000 (needed for non-custodial Keno)
 *   - All 102 fulfilled bets used the old constant CALLBACK_GAS = 500,000
 *   - Chainlink Amoy VRF cannot reliably fulfill 1M gas callbacks in a timely manner
 *   - Custodial fulfillRandomness does NO token transfers → well under 200K gas
 *   - 500,000 is sufficient for all games in custodial mode
 *
 * Run: npx hardhat run scripts/setCallbackGas.ts --network amoy
 */

import { ethers } from "hardhat";

const RC_PROXY     = "0x5A8b5C504743b7cd4A26adED19B77bA5B0421B67";
const TARGET_GAS   = 500_000;

const RC_ABI = [
  "function callbackGas() view returns (uint32)",
  "function setCallbackGas(uint32 gas_) external",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("─────────────────────────────────────────");
  console.log("setCallbackGas — RandomnessCoordinator");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MATIC");

  const rc = new ethers.Contract(RC_PROXY, RC_ABI, deployer);

  const current = await rc.callbackGas();
  console.log("Current callbackGas:", current.toString());

  if (Number(current) === TARGET_GAS) {
    console.log(`✓ Already set to ${TARGET_GAS} — no update needed.`);
    return;
  }

  console.log(`Setting callbackGas to ${TARGET_GAS}...`);
  const tx = await rc.setCallbackGas(TARGET_GAS);
  console.log("Tx hash:", tx.hash);
  await tx.wait();

  const updated = await rc.callbackGas();
  console.log(`✓ callbackGas updated: ${current} → ${updated}`);
  console.log("─────────────────────────────────────────");
  console.log("NOTE: This affects FUTURE VRF requests only.");
  console.log("Pending stuck requests (1M gas) cannot be re-submitted from our side.");
  console.log("They may eventually be fulfilled by Chainlink, or will need to be");
  console.log("refunded manually from the DB (mark PENDING bets as REFUNDED).");
  console.log("─────────────────────────────────────────");
}

main().catch((err) => { console.error(err); process.exit(1); });
