/**
 * Manual upgrade: deploy new DiceGame impl directly, then call upgradeToAndCall.
 * Bypasses OZ manifest caching. Use when upgradeDice.ts reuses the old impl address.
 */
import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "../../.env") });

const DICE_PROXY = "0x4b87dF81A498ed204590f9aF25b8889cd0cBC5f7";

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
  console.log("DiceGame v3 — direct implementation deploy");
  console.log("Network:", network.name, "ChainId:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MATIC");
  console.log("─────────────────────────────────────────────────────────");

  // 1. Deploy new implementation
  console.log("\n[1/3] Deploying new DiceGame implementation...");
  const Factory = await ethers.getContractFactory("DiceGame");
  const newImpl = await Factory.deploy();
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log("  ✓ New impl deployed:", newImplAddr);

  // 2. Point proxy to new impl
  console.log("\n[2/3] Upgrading proxy to new implementation...");
  const proxy = new ethers.Contract(DICE_PROXY, UPGRADE_ABI, deployer);
  const tx = await proxy.upgradeToAndCall(newImplAddr, "0x");
  await tx.wait();
  console.log("  ✓ Proxy upgraded. Tx:", tx.hash);

  // 3. Grant OPERATOR_ROLE to house wallet
  console.log("\n[3/3] Checking OPERATOR_ROLE for house wallet...");
  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
  const dice = await ethers.getContractAt("DiceGame", DICE_PROXY);
  const hasRole = await (dice as any).hasRole(OPERATOR_ROLE, houseWallet);
  if (!hasRole) {
    await (dice as any).grantRole(OPERATOR_ROLE, houseWallet);
    console.log("  ✓ OPERATOR_ROLE granted to", houseWallet);
  } else {
    console.log("  ℹ OPERATOR_ROLE already held by house wallet");
  }

  console.log("\n─────────────────────────────────────────────────────────");
  console.log("✅ DiceGame v3 upgrade complete");
  console.log("   Proxy:    ", DICE_PROXY);
  console.log("   New impl: ", newImplAddr);
  console.log("   canPay() check REMOVED from placeBetFor — custodial bets unblocked");
  console.log("─────────────────────────────────────────────────────────");
}

main().catch((err) => { console.error(err); process.exit(1); });
