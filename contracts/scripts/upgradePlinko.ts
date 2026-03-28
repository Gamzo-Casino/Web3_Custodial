/**
 * Manual upgrade: deploy new PlinkoGame impl directly, then call upgradeToAndCall.
 * Bypasses OZ manifest caching (same pattern as upgradeDiceV3.ts).
 * Adds dropBallFor() for custodial flow + bool custodial in Round struct.
 *
 * Run: cd contracts && npx hardhat run scripts/upgradePlinko.ts --network amoy
 */
import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "../../.env") });

const PLINKO_PROXY = "0x8e10fE2d7E642d21eAd14ff52F2ADD38e00c23de";

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
  console.log("PlinkoGame v2 — direct implementation deploy");
  console.log("Network:", network.name, "ChainId:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MATIC");
  console.log("─────────────────────────────────────────────────────────");

  // 1. Deploy new implementation
  console.log("\n[1/3] Deploying new PlinkoGame implementation...");
  const Factory = await ethers.getContractFactory("PlinkoGame");
  const newImpl = await Factory.deploy();
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log("  ✓ New impl deployed:", newImplAddr);

  // 2. Point proxy to new impl
  console.log("\n[2/3] Upgrading proxy to new implementation...");
  const proxy = new ethers.Contract(PLINKO_PROXY, UPGRADE_ABI, deployer);
  const tx = await proxy.upgradeToAndCall(newImplAddr, "0x");
  await tx.wait();
  console.log("  ✓ Proxy upgraded. Tx:", tx.hash);

  // 3. Grant OPERATOR_ROLE to house wallet
  console.log("\n[3/3] Checking OPERATOR_ROLE for house wallet...");
  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
  const plinko = await ethers.getContractAt("PlinkoGame", PLINKO_PROXY);
  const hasRole = await (plinko as any).hasRole(OPERATOR_ROLE, houseWallet);
  if (!hasRole) {
    await (plinko as any).grantRole(OPERATOR_ROLE, houseWallet);
    console.log("  ✓ OPERATOR_ROLE granted to", houseWallet);
  } else {
    console.log("  ℹ OPERATOR_ROLE already held by house wallet");
  }

  console.log("\n─────────────────────────────────────────────────────────");
  console.log("✅ PlinkoGame v2 upgrade complete");
  console.log("   Proxy:    ", PLINKO_PROXY);
  console.log("   New impl: ", newImplAddr);
  console.log("   dropBallFor() added — custodial bets enabled");
  console.log("─────────────────────────────────────────────────────────");
}

main().catch((err) => { console.error(err); process.exit(1); });
