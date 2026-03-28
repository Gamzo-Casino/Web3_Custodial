/**
 * Mint 10M GZO to treasury to ensure all games can pay worst-case.
 * Run: npx hardhat run scripts/fundTreasury.ts --network localhost
 */
import { ethers } from "hardhat";
import * as addresses from "../../src/lib/web3/deployed-addresses.json";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const gzo = await ethers.getContractAt("GZOToken", addresses.gzoToken);
  const treasury = await ethers.getContractAt("TreasuryVault", addresses.treasuryVault);

  const amount = ethers.parseEther("10000000"); // 10M GZO

  await (gzo as any).mint(deployer.address, amount);
  console.log("✓ Minted 10M GZO to deployer");

  await (gzo as any).approve(addresses.treasuryVault, amount);
  await (treasury as any).depositBankroll(amount);
  console.log("✓ Deposited 10M GZO to treasury");

  const bal = await (gzo as any).balanceOf(addresses.treasuryVault);
  console.log("Treasury balance:", ethers.formatEther(bal), "GZO");
}

main().catch((e) => { console.error(e); process.exit(1); });
