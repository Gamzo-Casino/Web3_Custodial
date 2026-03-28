/**
 * Resume deployment — deploys BlackjackGame + HiloGame, then wires ALL 11 games.
 * Run: npx hardhat run scripts/deployResume.ts --network amoy
 */

import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── All already-deployed addresses ────────────────────────────────────────────
const GZO_TOKEN      = "0x43446C2FE00E94CF4aee508A64D301e90776F23E";
const TREASURY       = "0xE74c5A5d10F5CcE18282Cd306AF207e0Fd310aAd";
const REGISTRY       = "0x068e1830F7Faed4d4E31FdfF5e1979a24e3003d4";
const COORDINATOR    = "0x5A8b5C504743b7cd4A26adED19B77bA5B0421B67";
const COINFLIP_GAME  = "0xea006b75A3564e66777dCC435954177dd860DD9c";
const DICE_GAME      = "0x4b87dF81A498ed204590f9aF25b8889cd0cBC5f7";
const LIMBO_GAME     = "0xeebbCe5A5Cf8a8b37988DCE3a7cA6F39Eefc62F7";
const CRASH_GAME     = "0x4d1b3C9Df431Bbad6A3981F7f68f6C61C1597ad3";
const WHEEL_GAME     = "0x98c304b90f14c69275014eb22Eb60694d07184a2";
const ROULETTE_GAME  = "0x13CeBf51251547A048DF83A5561a0361822e298b";
const PLINKO_GAME    = "0x8e10fE2d7E642d21eAd14ff52F2ADD38e00c23de";
const KENO_GAME      = "0x44dC17d94345B4970caCecF7954AB676A25c6125";
const MINES_GAME     = "0x55d8093C2e75E682f6183EC78e4D35641010046f";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("─────────────────────────────────────────");
  console.log("Final Resume — BlackjackGame + HiloGame");
  console.log("Network:", network.name, "ChainId:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MATIC");
  console.log("─────────────────────────────────────────");

  const admin    = deployer.address;
  const minStake = ethers.parseEther("1");
  const maxStake = ethers.parseEther("10000");
  const gameArgs = [admin, TREASURY, COORDINATOR, minStake, maxStake];

  async function deployGame(name: string, args: unknown[]) {
    console.log(`\nDeploying ${name}...`);
    const Factory = await ethers.getContractFactory(name);
    const proxy = await upgrades.deployProxy(Factory, args, { initializer: "initialize", kind: "uups" });
    await proxy.waitForDeployment();
    const addr = await proxy.getAddress();
    console.log(`✓ ${name}:`, addr);
    return addr;
  }

  // ── Deploy final 2 games ───────────────────────────────────────────────────
  const blackjackAddr = await deployGame("BlackjackGame", gameArgs);
  const hiloAddr      = await deployGame("HiloGame",      gameArgs);

  // ── Wire ALL 11 games (none wired yet — script always failed pre-wiring) ───
  console.log("\n[Setup] Granting GAME_ROLE and registering ALL 11 games...");

  const GAME_ROLE   = ethers.keccak256(ethers.toUtf8Bytes("GAME_ROLE"));
  const treasury    = await ethers.getContractAt("TreasuryVault",         TREASURY);
  const coordinator = await ethers.getContractAt("RandomnessCoordinator", COORDINATOR);
  const registry    = await ethers.getContractAt("GameRegistry",          REGISTRY);

  const allGames: [string, string][] = [
    ["COINFLIP",  COINFLIP_GAME],
    ["DICE",      DICE_GAME],
    ["LIMBO",     LIMBO_GAME],
    ["CRASH",     CRASH_GAME],
    ["WHEEL",     WHEEL_GAME],
    ["ROULETTE",  ROULETTE_GAME],
    ["PLINKO",    PLINKO_GAME],
    ["KENO",      KENO_GAME],
    ["MINES",     MINES_GAME],
    ["BLACKJACK", blackjackAddr],
    ["HILO",      hiloAddr],
  ];

  for (const [name, addr] of allGames) {
    await (treasury    as any).grantRole(GAME_ROLE, addr);
    await (coordinator as any).grantRole(GAME_ROLE, addr);
    const gameId = ethers.keccak256(ethers.toUtf8Bytes(name));
    await (registry    as any).registerGame(gameId, addr);
    console.log(`  ✓ ${name} → ${addr}`);
  }

  // ── Write complete address manifest ───────────────────────────────────────
  const addresses = {
    network: "amoy",
    chainId: 80002,
    deployedAt: new Date().toISOString(),
    gzoToken:              GZO_TOKEN,
    treasuryVault:         TREASURY,
    gameRegistry:          REGISTRY,
    randomnessCoordinator: COORDINATOR,
    coinFlipGame:          COINFLIP_GAME,
    diceGame:              DICE_GAME,
    limboGame:             LIMBO_GAME,
    crashGame:             CRASH_GAME,
    wheelGame:             WHEEL_GAME,
    rouletteGame:          ROULETTE_GAME,
    plinkoGame:            PLINKO_GAME,
    kenoGame:              KENO_GAME,
    minesGame:             MINES_GAME,
    blackjackGame:         blackjackAddr,
    hiloGame:              hiloAddr,
  };

  const manifestPath = path.join(__dirname, "../deployed-addresses.json");
  fs.writeFileSync(manifestPath, JSON.stringify(addresses, null, 2));

  const frontendPath = path.join(__dirname, "../../src/lib/web3/deployed-addresses.json");
  fs.mkdirSync(path.dirname(frontendPath), { recursive: true });
  fs.writeFileSync(frontendPath, JSON.stringify(addresses, null, 2));

  console.log("\n✅ All addresses written to frontend config");
  console.log("\n─────────────────────────────────────────");
  console.log("ALL 11 GAMES DEPLOYED AND WIRED ✓");
  console.log("\nRandomnessCoordinator (add as VRF consumer):");
  console.log(" ", COORDINATOR);
  console.log("\nTreasuryVault (fund with GZO):");
  console.log(" ", TREASURY);
  console.log("─────────────────────────────────────────");
}

main().catch((err) => { console.error(err); process.exit(1); });
