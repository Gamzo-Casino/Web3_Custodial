/**
 * Local development deployment script.
 *
 * Token distribution:
 *   - 200,000 GZO → TreasuryVault (game bankroll)
 *   - 800,000 GZO → player wallet (PLAYER_ADDRESS)
 *
 * Usage:
 *   npx hardhat run scripts/deployLocal.ts --network localhost
 */

import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const PLAYER_ADDRESS = "0x3188f8a7627279E7D287CEEfb0080c6E350Fe528";
const TREASURY_GZO   = ethers.parseEther("200000");   // 200k GZO
const PLAYER_GZO     = ethers.parseEther("800000");    // 800k GZO
const PLAYER_ETH     = ethers.parseEther("10");        // 10 ETH for gas

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("═══════════════════════════════════════════");
  console.log("  Gamzo Casino — Local Deployment");
  console.log("  Network :", network.name, "ChainId:", network.chainId.toString());
  console.log("  Deployer:", deployer.address);
  console.log("  Balance :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("═══════════════════════════════════════════");

  const admin = deployer.address;
  const minStake = ethers.parseEther("1");
  const maxStake = ethers.parseEther("10000");

  // ── VRF: deploy MockVRFCoordinator ─────────────────────────────────────────
  console.log("\n[0] Deploying MockVRFCoordinator...");
  const MockVRF = await ethers.getContractFactory("MockVRFCoordinator");
  const mockVRF = await MockVRF.deploy();
  await mockVRF.waitForDeployment();
  const vrfCoordinatorAddr = await mockVRF.getAddress();
  console.log("  ✓ MockVRFCoordinator:", vrfCoordinatorAddr);

  // ── 1. GZO Token ───────────────────────────────────────────────────────────
  console.log("\n[1] Deploying GZOToken...");
  const GZOToken = await ethers.getContractFactory("GZOToken");
  const gzoToken = await upgrades.deployProxy(GZOToken, [admin], {
    initializer: "initialize",
    kind: "uups",
  });
  await gzoToken.waitForDeployment();
  const gzoAddr = await gzoToken.getAddress();
  console.log("  ✓ GZOToken:", gzoAddr);

  // ── 2. TreasuryVault ───────────────────────────────────────────────────────
  console.log("\n[2] Deploying TreasuryVault...");
  const TreasuryVault = await ethers.getContractFactory("TreasuryVault");
  const treasury = await upgrades.deployProxy(TreasuryVault, [gzoAddr, admin], {
    initializer: "initialize",
    kind: "uups",
  });
  await treasury.waitForDeployment();
  const treasuryAddr = await treasury.getAddress();
  console.log("  ✓ TreasuryVault:", treasuryAddr);

  // ── 3. GameRegistry ────────────────────────────────────────────────────────
  console.log("\n[3] Deploying GameRegistry...");
  const GameRegistry = await ethers.getContractFactory("GameRegistry");
  const registry = await upgrades.deployProxy(GameRegistry, [admin], {
    initializer: "initialize",
    kind: "uups",
  });
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("  ✓ GameRegistry:", registryAddr);

  // ── 4. RandomnessCoordinator ───────────────────────────────────────────────
  console.log("\n[4] Deploying RandomnessCoordinator...");
  const RandomnessCoordinator = await ethers.getContractFactory("RandomnessCoordinator");
  const coordinator = await upgrades.deployProxy(
    RandomnessCoordinator,
    [admin, vrfCoordinatorAddr, ethers.ZeroHash, 1n],
    { initializer: "initialize", kind: "uups" }
  );
  await coordinator.waitForDeployment();
  const coordinatorAddr = await coordinator.getAddress();
  console.log("  ✓ RandomnessCoordinator:", coordinatorAddr);

  // ── 5–15. Game Contracts ───────────────────────────────────────────────────
  const gameArgs = [admin, treasuryAddr, coordinatorAddr, minStake, maxStake];

  async function deployGame(name: string, idx: number, args: unknown[]) {
    console.log(`\n[${idx}] Deploying ${name}...`);
    const Factory = await ethers.getContractFactory(name);
    const proxy = await upgrades.deployProxy(Factory, args, {
      initializer: "initialize",
      kind: "uups",
    });
    await proxy.waitForDeployment();
    const addr = await proxy.getAddress();
    console.log(`  ✓ ${name}: ${addr}`);
    return addr;
  }

  const coinFlipAddr  = await deployGame("CoinFlipGame",  5,  gameArgs);
  const diceAddr      = await deployGame("DiceGame",      6,  gameArgs);
  const limboAddr     = await deployGame("LimboGame",     7,  gameArgs);
  const crashAddr     = await deployGame("CrashGame",     8,  gameArgs);
  const wheelAddr     = await deployGame("WheelGame",     9,  gameArgs);
  const rouletteAddr  = await deployGame("RouletteGame",  10, gameArgs);
  const plinkoAddr    = await deployGame("PlinkoGame",    11, gameArgs);
  const kenoAddr      = await deployGame("KenoGame",      12, gameArgs);
  const minesAddr     = await deployGame("MinesGame",     13, gameArgs);
  const blackjackAddr = await deployGame("BlackjackGame", 14, gameArgs);
  const hiloAddr      = await deployGame("HiloGame",      15, gameArgs);

  const gameAddresses = [
    coinFlipAddr, diceAddr, limboAddr, crashAddr, wheelAddr,
    rouletteAddr, plinkoAddr, kenoAddr, minesAddr, blackjackAddr, hiloAddr,
  ];
  const gameNames = [
    "COINFLIP", "DICE", "LIMBO", "CRASH", "WHEEL",
    "ROULETTE", "PLINKO", "KENO", "MINES", "BLACKJACK", "HILO",
  ];

  // ── Grant roles + register games ───────────────────────────────────────────
  console.log("\n[Setup] Granting GAME_ROLE + registering games...");
  const GAME_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GAME_ROLE"));
  for (let i = 0; i < gameAddresses.length; i++) {
    await (treasury as any).grantRole(GAME_ROLE, gameAddresses[i]);
    await (coordinator as any).grantRole(GAME_ROLE, gameAddresses[i]);
    const gameId = ethers.keccak256(ethers.toUtf8Bytes(gameNames[i]));
    await (registry as any).registerGame(gameId, gameAddresses[i]);
    console.log(`  ✓ ${gameNames[i]}`);
  }

  // ── Token distribution ─────────────────────────────────────────────────────
  console.log("\n[Token] Distributing 1,000,000 GZO...");

  // Mint total supply to deployer
  await (gzoToken as any).mint(admin, TREASURY_GZO + PLAYER_GZO);

  // 200k → Treasury bankroll
  await (gzoToken as any).approve(treasuryAddr, TREASURY_GZO);
  await (treasury as any).depositBankroll(TREASURY_GZO);
  console.log("  ✓ Treasury bankroll: 200,000 GZO deposited");

  // 800k → player wallet
  await (gzoToken as any).transfer(PLAYER_ADDRESS, PLAYER_GZO);
  console.log("  ✓ Player wallet:     800,000 GZO transferred to", PLAYER_ADDRESS);

  // Also send ETH for gas
  await deployer.sendTransaction({ to: PLAYER_ADDRESS, value: PLAYER_ETH });
  console.log("  ✓ Player wallet:     10 ETH sent for gas");

  // ── Write address manifests ────────────────────────────────────────────────
  const addresses = {
    network: "localhost",
    chainId: 31337,
    deployedAt: new Date().toISOString(),
    gzoToken: gzoAddr,
    treasuryVault: treasuryAddr,
    gameRegistry: registryAddr,
    randomnessCoordinator: coordinatorAddr,
    mockVRFCoordinator: vrfCoordinatorAddr,
    coinFlipGame: coinFlipAddr,
    diceGame: diceAddr,
    limboGame: limboAddr,
    crashGame: crashAddr,
    wheelGame: wheelAddr,
    rouletteGame: rouletteAddr,
    plinkoGame: plinkoAddr,
    kenoGame: kenoAddr,
    minesGame: minesAddr,
    blackjackGame: blackjackAddr,
    hiloGame: hiloAddr,
  };

  const manifestPath = path.join(__dirname, "../deployed-addresses.json");
  fs.writeFileSync(manifestPath, JSON.stringify(addresses, null, 2));

  const frontendPath = path.join(__dirname, "../../src/lib/web3/deployed-addresses.json");
  fs.mkdirSync(path.dirname(frontendPath), { recursive: true });
  fs.writeFileSync(frontendPath, JSON.stringify(addresses, null, 2));

  console.log("\n═══════════════════════════════════════════");
  console.log("  ✅ Local deployment complete!");
  console.log("  GZO Token:    ", gzoAddr);
  console.log("  Treasury:     ", treasuryAddr);
  console.log("  Player gets:  800,000 GZO + 10 ETH");
  console.log("  Treasury has: 200,000 GZO bankroll");
  console.log("═══════════════════════════════════════════");
  console.log("\n  Next steps:");
  console.log("  1. Add localhost network to MetaMask:");
  console.log("     RPC: http://127.0.0.1:8545  ChainID: 31337");
  console.log("  2. Import your wallet and check GZO balance");
  console.log("  3. npm run dev (in Casino root)");
  console.log("═══════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
