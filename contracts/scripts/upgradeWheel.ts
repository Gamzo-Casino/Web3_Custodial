/**
 * Manual upgrade: deploy new WheelGame impl directly, then call upgradeToAndCall.
 * Bypasses OZ manifest caching (same pattern as upgradeKeno.ts / upgradePlinko.ts).
 * Adds spinFor() for custodial flow + bool custodial in Round struct.
 *
 * Run: cd contracts && npx hardhat run scripts/upgradeWheel.ts --network amoy
 */
import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "../../.env") });

const WHEEL_PROXY = "0x98c304b90f14c69275014eb22Eb60694d07184a2";

const UPGRADE_ABI = [
  "function upgradeToAndCall(address newImplementation, bytes calldata data) external",
  "function implementation() external view returns (address)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const houseWallet = process.env.NEXT_PUBLIC_HOUSE_DEPOSIT_ADDRESS ?? "";
  if (!houseWallet) throw new Error("NEXT_PUBLIC_HOUSE_DEPOSIT_ADDRESS not set");

  console.log("─────────────────────────────────────────────────────────");
  console.log("WheelGame v2 — custodial upgrade");
  console.log("Network:", network.name, "ChainId:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MATIC");
  console.log("─────────────────────────────────────────────────────────");

  console.log("\n[1/3] Deploying new WheelGame implementation...");
  const Factory = await ethers.getContractFactory("WheelGame");
  const newImpl = await Factory.deploy();
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log("  ✓ New impl deployed:", newImplAddr);

  console.log("\n[2/3] Upgrading proxy to new implementation...");
  const proxy = new ethers.Contract(WHEEL_PROXY, UPGRADE_ABI, deployer);
  const tx = await proxy.upgradeToAndCall(newImplAddr, "0x");
  await tx.wait();
  console.log("  ✓ Proxy upgraded. Tx:", tx.hash);

  console.log("\n[3/3] Checking OPERATOR_ROLE for house wallet...");
  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
  const wheel = await ethers.getContractAt("WheelGame", WHEEL_PROXY);
  const hasRole = await (wheel as any).hasRole(OPERATOR_ROLE, houseWallet);
  if (!hasRole) {
    await (wheel as any).grantRole(OPERATOR_ROLE, houseWallet);
    console.log("  ✓ OPERATOR_ROLE granted to", houseWallet);
  } else {
    console.log("  ℹ OPERATOR_ROLE already held by house wallet");
  }

  console.log("\n─────────────────────────────────────────────────────────");
  console.log("✅ WheelGame v2 upgrade complete");
  console.log("   Proxy:    ", WHEEL_PROXY);
  console.log("   New impl: ", newImplAddr);
  console.log("   spinFor() added — custodial bets enabled");
  console.log("─────────────────────────────────────────────────────────");
}

main().catch((err) => { console.error(err); process.exit(1); });
