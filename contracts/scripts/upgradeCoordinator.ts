/**
 * Upgrade RandomnessCoordinator proxy to the fixed VRF v2.5 implementation.
 * Run: npx hardhat run scripts/upgradeCoordinator.ts --network amoy
 */

import { ethers, upgrades } from "hardhat";

const COORDINATOR_PROXY = "0x5A8b5C504743b7cd4A26adED19B77bA5B0421B67";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("─────────────────────────────────────────");
  console.log("Upgrading RandomnessCoordinator");
  console.log("Network:", network.name, "ChainId:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MATIC");
  console.log("Proxy:", COORDINATOR_PROXY);
  console.log("─────────────────────────────────────────");

  const Factory = await ethers.getContractFactory("RandomnessCoordinator");
  const upgraded = await upgrades.upgradeProxy(COORDINATOR_PROXY, Factory);
  await upgraded.waitForDeployment();

  const implAddr = await upgrades.erc1967.getImplementationAddress(COORDINATOR_PROXY);
  console.log("✓ Upgrade complete");
  console.log("  Proxy:          ", COORDINATOR_PROXY);
  console.log("  New impl:       ", implAddr);

  // NOTE: callbackGas is intentionally left at 500,000 (set via setCallbackGas.ts).
  // 500K is sufficient for all custodial games; 1M caused Chainlink Amoy to stall.
  const coordinator = await ethers.getContractAt("RandomnessCoordinator", COORDINATOR_PROXY);
  const gas = await coordinator.callbackGas();
  console.log("  callbackGas =", gas.toString(), "(unchanged)");
  console.log("─────────────────────────────────────────");
}

main().catch((err) => { console.error(err); process.exit(1); });
