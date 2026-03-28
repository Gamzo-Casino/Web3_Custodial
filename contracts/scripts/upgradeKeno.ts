/**
 * Manual upgrade: deploy new KenoGame impl directly, then call upgradeToAndCall.
 * Bypasses OZ manifest caching (same pattern as upgradeDiceV3.ts / upgradePlinko.ts).
 * Adds placeBetFor() for custodial flow + bool custodial in Round struct.
 *
 * Run: cd contracts && npx hardhat run scripts/upgradeKeno.ts --network amoy
 */
import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "../../.env") });

const KENO_PROXY = "0x44dC17d94345B4970caCecF7954AB676A25c6125";

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
  console.log("KenoGame v2 — direct implementation deploy");
  console.log("Network:", network.name, "ChainId:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MATIC");
  console.log("─────────────────────────────────────────────────────────");

  console.log("\n[1/3] Deploying new KenoGame implementation...");
  const Factory = await ethers.getContractFactory("KenoGame");
  const newImpl = await Factory.deploy();
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log("  ✓ New impl deployed:", newImplAddr);

  console.log("\n[2/3] Upgrading proxy to new implementation...");
  const proxy = new ethers.Contract(KENO_PROXY, UPGRADE_ABI, deployer);
  const tx = await proxy.upgradeToAndCall(newImplAddr, "0x");
  await tx.wait();
  console.log("  ✓ Proxy upgraded. Tx:", tx.hash);

  console.log("\n[3/3] Checking OPERATOR_ROLE for house wallet...");
  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
  const keno = await ethers.getContractAt("KenoGame", KENO_PROXY);
  const hasRole = await (keno as any).hasRole(OPERATOR_ROLE, houseWallet);
  if (!hasRole) {
    await (keno as any).grantRole(OPERATOR_ROLE, houseWallet);
    console.log("  ✓ OPERATOR_ROLE granted to", houseWallet);
  } else {
    console.log("  ℹ OPERATOR_ROLE already held by house wallet");
  }

  console.log("\n─────────────────────────────────────────────────────────");
  console.log("✅ KenoGame v2 upgrade complete");
  console.log("   Proxy:    ", KENO_PROXY);
  console.log("   New impl: ", newImplAddr);
  console.log("   placeBetFor() added — custodial bets enabled");
  console.log("─────────────────────────────────────────────────────────");
}

main().catch((err) => { console.error(err); process.exit(1); });
