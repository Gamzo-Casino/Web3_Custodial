/**
 * Fund TreasuryVault on testnet using GZO tokens already in deployer's wallet.
 * (Unlike fundTreasury.ts, this does NOT call mint — it uses existing tokens.)
 *
 * Usage:
 *   npx hardhat run scripts/fundTreasuryTestnet.ts --network amoy
 *
 * Set BANKROLL_AMOUNT in contracts/.env (default: 100000 GZO)
 */
import { ethers } from "hardhat";
import * as addresses from "../../src/lib/web3/deployed-addresses.json";

const GZO_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function transfer(address, uint256) returns (bool)",
];

const TREASURY_ABI = [
  "function depositBankroll(uint256 amount) external",
  "function canPay(uint256) view returns (bool)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("GZO Token:", addresses.gzoToken);
  console.log("TreasuryVault:", addresses.treasuryVault);

  const gzo = new ethers.Contract(addresses.gzoToken, GZO_ABI, deployer);
  const treasury = new ethers.Contract(addresses.treasuryVault, TREASURY_ABI, deployer);

  const deployerBalance = await gzo.balanceOf(deployer.address);
  console.log("Deployer GZO balance:", ethers.formatEther(deployerBalance));

  const bankrollAmountStr = process.env.BANKROLL_AMOUNT ?? "100000";
  const amount = ethers.parseEther(bankrollAmountStr);

  if (deployerBalance < amount) {
    throw new Error(
      `Insufficient GZO balance. Have ${ethers.formatEther(deployerBalance)}, need ${bankrollAmountStr}`
    );
  }

  console.log(`\nFunding treasury with ${bankrollAmountStr} GZO...`);

  const approveTx = await gzo.approve(addresses.treasuryVault, amount);
  await approveTx.wait();
  console.log("✓ Approved TreasuryVault to spend GZO");

  const depositTx = await treasury.depositBankroll(amount);
  await depositTx.wait();
  console.log("✓ Deposited", bankrollAmountStr, "GZO to treasury");

  const treasuryBal = await gzo.balanceOf(addresses.treasuryVault);
  console.log("Treasury GZO balance:", ethers.formatEther(treasuryBal));
}

main().catch((e) => { console.error(e); process.exit(1); });
