/**
 * Upgrade DiceGame proxy to v2 — adds placeBetFor() for custodial flow.
 * Also grants OPERATOR_ROLE to the house wallet so the backend can call placeBetFor.
 *
 * Run: npx hardhat run scripts/upgradeDice.ts --network amoy
 *
 * Requires env vars:
 *   DEPLOYER_PRIVATE_KEY  — admin/deployer key (holds UPGRADER_ROLE + DEFAULT_ADMIN_ROLE)
 *   NEXT_PUBLIC_HOUSE_DEPOSIT_ADDRESS — house wallet to grant OPERATOR_ROLE
 */
import { ethers, upgrades } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "../../.env") });

const DICE_PROXY = "0x4b87dF81A498ed204590f9aF25b8889cd0cBC5f7";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  const houseWallet = process.env.NEXT_PUBLIC_HOUSE_DEPOSIT_ADDRESS ?? "";
  if (!houseWallet) throw new Error("NEXT_PUBLIC_HOUSE_DEPOSIT_ADDRESS not set in .env");

  console.log("─────────────────────────────────────────────────────────");
  console.log("Upgrading DiceGame → v2 (custodial placeBetFor support)");
  console.log("Network:", network.name, "ChainId:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MATIC");
  console.log("Proxy:  ", DICE_PROXY);
  console.log("House:  ", houseWallet);
  console.log("─────────────────────────────────────────────────────────");

  // ── 1. Upgrade proxy ──────────────────────────────────────────────────────
  console.log("\n[1/2] Upgrading DiceGame proxy...");
  const Factory = await ethers.getContractFactory("DiceGame");

  // Force-import the existing proxy into the OZ manifest (needed when deploying
  // from a different machine than the original deploy).
  try {
    await upgrades.forceImport(DICE_PROXY, Factory, { kind: "uups" });
    console.log("  ✓ Proxy imported into local manifest");
  } catch {
    // Already imported — safe to ignore
  }

  const upgraded = await upgrades.upgradeProxy(DICE_PROXY, Factory);
  await upgraded.waitForDeployment();

  const implAddr = await upgrades.erc1967.getImplementationAddress(DICE_PROXY);
  console.log("✓ DiceGame upgraded");
  console.log("  Proxy:    ", DICE_PROXY);
  console.log("  New impl: ", implAddr);

  // ── 2. Grant OPERATOR_ROLE to house wallet ────────────────────────────────
  console.log("\n[2/2] Granting OPERATOR_ROLE to house wallet...");
  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
  const dice = await ethers.getContractAt("DiceGame", DICE_PROXY);

  const alreadyHas = await (dice as any).hasRole(OPERATOR_ROLE, houseWallet);
  if (alreadyHas) {
    console.log("  ℹ House wallet already has OPERATOR_ROLE — skipping.");
  } else {
    await (dice as any).grantRole(OPERATOR_ROLE, houseWallet);
    console.log("  ✓ OPERATOR_ROLE granted to", houseWallet);
  }

  console.log("\n─────────────────────────────────────────────────────────");
  console.log("✅ DiceGame upgrade complete.");
  console.log("   Backend can now call placeBetFor() using the house wallet.");
  console.log("─────────────────────────────────────────────────────────");
}

main().catch((err) => { console.error(err); process.exit(1); });
