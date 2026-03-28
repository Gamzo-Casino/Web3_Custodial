import { ethers } from "hardhat";

const MINES_PROXY = "0x55d8093C2e75E682f6183EC78e4D35641010046f";
const HOUSE_WALLET = "0xF2050102401849d615e1855A9FAd4327CDeeF2cF";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("─────────────────────────────────────────────────────────");
  console.log("MinesGame v2 — direct implementation deploy");
  console.log(`Network: ${network.name} ChainId: ${network.chainId}`);
  console.log(`Deployer: ${deployer.address}`);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(bal)} MATIC`);
  console.log("─────────────────────────────────────────────────────────\n");

  // 1. Deploy new implementation
  console.log("[1/3] Deploying new MinesGame implementation...");
  const Factory = await ethers.getContractFactory("MinesGame");
  const newImpl = await Factory.deploy();
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log(`  ✓ New impl deployed: ${newImplAddr}\n`);

  // 2. Upgrade proxy
  console.log("[2/3] Upgrading proxy to new implementation...");
  const proxy = await ethers.getContractAt(
    ["function upgradeToAndCall(address newImplementation, bytes calldata data) external",
     "function hasRole(bytes32 role, address account) external view returns (bool)",
     "function grantRole(bytes32 role, address account) external",
     "function OPERATOR_ROLE() external view returns (bytes32)"],
    MINES_PROXY
  );
  const upgradeTx = await proxy.upgradeToAndCall(newImplAddr, "0x");
  await upgradeTx.wait();
  console.log(`  ✓ Proxy upgraded. Tx: ${upgradeTx.hash}\n`);

  // 3. Ensure OPERATOR_ROLE for house wallet
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
  console.log("✅ MinesGame v2 upgrade complete");
  console.log(`   Proxy:     ${MINES_PROXY}`);
  console.log(`   New impl:  ${newImplAddr}`);
  console.log(`   startRoundFor() + cashoutFor() + loseRoundFor() added — custodial bets enabled`);
  console.log("─────────────────────────────────────────────────────────");
}

main().catch((err) => { console.error(err); process.exit(1); });
