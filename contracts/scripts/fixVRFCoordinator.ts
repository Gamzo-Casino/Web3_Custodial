/**
 * Fix: update RandomnessCoordinator's vrfCoordinator address to the correct one.
 * Run: npx hardhat run scripts/fixVRFCoordinator.ts --network amoy
 */

import { ethers } from "hardhat";

const RC_PROXY          = "0x5A8b5C504743b7cd4A26adED19B77bA5B0421B67";
const CORRECT_VRF       = "0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf2";
const KEY_HASH          = "0x816bedba8a50b294e5cbd47842baf240c2385f2eaf719edbd4f250a137a8c899";
const SUBSCRIPTION_ID   = "37121473965311191308103942488437766006292923759699378585569059143270839490077";

const RC_ABI = [
  "function vrfCoordinator() view returns (address)",
  "function setVRFConfig(address coord, bytes32 kh, uint256 subId) external",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = ethers.provider;

  console.log("─────────────────────────────────────────");
  console.log("Fixing VRF Coordinator address");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await provider.getBalance(deployer.address)), "MATIC");

  const rc = new ethers.Contract(RC_PROXY, RC_ABI, deployer);

  const current = await rc.vrfCoordinator();
  console.log("Current vrfCoordinator:", current);
  console.log("Correct vrfCoordinator:", CORRECT_VRF);

  if (current.toLowerCase() === CORRECT_VRF.toLowerCase()) {
    console.log("✓ Already correct — no update needed.");
    return;
  }

  console.log("Sending setVRFConfig...");
  const tx = await rc.setVRFConfig(CORRECT_VRF, KEY_HASH, BigInt(SUBSCRIPTION_ID));
  console.log("Tx hash:", tx.hash);
  await tx.wait();

  const updated = await rc.vrfCoordinator();
  console.log("✓ vrfCoordinator updated to:", updated);
  console.log("─────────────────────────────────────────");
}

main().catch((err) => { console.error(err); process.exit(1); });
