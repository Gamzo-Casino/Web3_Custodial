import { ethers } from "hardhat";

const HILO_PROXY  = "0x8572650a140f27F481aFA0359877cEE99d08d241";
const HOUSE_WALLET = "0xF2050102401849d615e1855A9FAd4327CDeeF2cF";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("─────────────────────────────────────────────────────────");
  console.log("HiloGame v2 — direct implementation deploy");
  console.log(`Network: ${network.name} ChainId: ${network.chainId}`);
  console.log(`Deployer: ${deployer.address}`);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(bal)} MATIC`);
  console.log("─────────────────────────────────────────────────────────\n");

  console.log("[1/3] Deploying new HiloGame implementation...");
  const Factory = await ethers.getContractFactory("HiloGame");
  const newImpl  = await Factory.deploy();
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log(`  ✓ New impl deployed: ${newImplAddr}\n`);

  console.log("[2/3] Upgrading proxy to new implementation...");
  const proxy = await ethers.getContractAt(
    ["function upgradeToAndCall(address newImplementation, bytes calldata data) external",
     "function hasRole(bytes32 role, address account) external view returns (bool)",
     "function grantRole(bytes32 role, address account) external",
     "function OPERATOR_ROLE() external view returns (bytes32)"],
    HILO_PROXY
  );
  const upgradeTx = await proxy.upgradeToAndCall(newImplAddr, "0x");
  await upgradeTx.wait();
  console.log(`  ✓ Proxy upgraded. Tx: ${upgradeTx.hash}\n`);

  console.log("[3/3] Checking OPERATOR_ROLE for house wallet...");
  const OPERATOR_ROLE = await proxy.OPERATOR_ROLE();
  const hasRole = await proxy.hasRole(OPERATOR_ROLE, HOUSE_WALLET);
  if (!hasRole) {
    const tx = await proxy.grantRole(OPERATOR_ROLE, HOUSE_WALLET);
    await tx.wait();
    console.log(`  ✓ OPERATOR_ROLE granted to ${HOUSE_WALLET}`);
  } else {
    console.log(`  ✓ OPERATOR_ROLE already set for ${HOUSE_WALLET}`);
  }

  console.log("\n─────────────────────────────────────────────────────────");
  console.log("✅ HiloGame v2 upgrade complete");
  console.log(`   Proxy:     ${HILO_PROXY}`);
  console.log(`   New impl:  ${newImplAddr}`);
  console.log(`   startRoundFor() added — custodial bets enabled`);
  console.log(`   _hiloRank() fixed to match TS ordering (Two=lowest, Ace=highest)`);
  console.log("─────────────────────────────────────────────────────────");
}

main().catch((err) => { console.error(err); process.exit(1); });
