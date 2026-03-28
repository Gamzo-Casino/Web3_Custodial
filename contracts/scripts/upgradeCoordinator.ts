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

  // Set callbackGas to 1,000,000 (was hard-coded constant 500,000 — Keno needs more)
  console.log("─────────────────────────────────────────");
  console.log("Setting callbackGas = 1,000,000...");
  const coordinator = await ethers.getContractAt("RandomnessCoordinator", COORDINATOR_PROXY);
  const tx = await coordinator.setCallbackGas(1_000_000);
  await tx.wait();
  const gas = await coordinator.callbackGas();
  console.log("✓ callbackGas =", gas.toString());
  console.log("─────────────────────────────────────────");
}

main().catch((err) => { console.error(err); process.exit(1); });
