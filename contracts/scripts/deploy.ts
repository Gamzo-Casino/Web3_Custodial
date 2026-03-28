import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface DeployedAddresses {
  network: string;
  chainId: number;
  deployedAt: string;
  gzoToken: string;
  treasuryVault: string;
  gameRegistry: string;
  randomnessCoordinator: string;
  mockVRFCoordinator?: string;
  coinFlipGame: string;
  diceGame: string;
  limboGame: string;
  crashGame: string;
  wheelGame: string;
  rouletteGame: string;
  plinkoGame: string;
  kenoGame: string;
  minesGame: string;
  blackjackGame: string;
  hiloGame: string;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("─────────────────────────────────────────");
  console.log("Deploying Gamzo Protocol v2 — All Games");
  console.log("Network:", network.name, "ChainId:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MATIC");
  console.log("─────────────────────────────────────────");

  const admin = deployer.address;
  const isLocal = network.chainId === 31337n;

  // ── VRF config ────────────────────────────────────────────────────────────
  let vrfCoordinatorAddr: string;
  let keyHash: string;
  let subscriptionId: bigint;
  let mockVRFAddr: string | undefined;

  if (isLocal) {
    const MockVRF = await ethers.getContractFactory("MockVRFCoordinator");
    const mockVRF = await MockVRF.deploy();
    await mockVRF.waitForDeployment();
    mockVRFAddr = await mockVRF.getAddress();
    vrfCoordinatorAddr = mockVRFAddr;
    keyHash = ethers.ZeroHash;
    subscriptionId = 1n;
    console.log("MockVRFCoordinator:", vrfCoordinatorAddr);
  } else {
    vrfCoordinatorAddr = process.env.VRF_COORDINATOR ?? "";
    keyHash            = process.env.VRF_KEY_HASH ?? "";
    subscriptionId     = BigInt(process.env.VRF_SUBSCRIPTION_ID ?? "0");
    if (!vrfCoordinatorAddr) throw new Error("VRF_COORDINATOR not set");
    if (!keyHash) throw new Error("VRF_KEY_HASH not set");
    if (subscriptionId === 0n) throw new Error("VRF_SUBSCRIPTION_ID not set");
  }

  const minStake = ethers.parseEther("1");
  const maxStake = ethers.parseEther("10000");

  // ── 1. GZO Token ──────────────────────────────────────────────────────────
  // If GZO_TOKEN_ADDRESS is provided, use that existing token (testnet).
  // Otherwise deploy a new one (local dev only).
  let gzoAddr: string;
  const existingGZO = process.env.GZO_TOKEN_ADDRESS ?? "";

  if (existingGZO) {
    gzoAddr = existingGZO;
    console.log("\n[1/15] Using existing GZO token:", gzoAddr);
  } else if (isLocal) {
    console.log("\n[1/15] Deploying GZOToken (local dev)...");
    const GZOToken = await ethers.getContractFactory("GZOToken");
    const gzoToken = await upgrades.deployProxy(GZOToken, [admin], { initializer: "initialize", kind: "uups" });
    await gzoToken.waitForDeployment();
    gzoAddr = await gzoToken.getAddress();
    console.log("✓ GZOToken:", gzoAddr);
  } else {
    throw new Error("GZO_TOKEN_ADDRESS must be set for non-local deployments");
  }

  // ── 2. Treasury Vault ─────────────────────────────────────────────────────
  console.log("\n[2/15] Deploying TreasuryVault...");
  const TreasuryVault = await ethers.getContractFactory("TreasuryVault");
  const treasury = await upgrades.deployProxy(TreasuryVault, [gzoAddr, admin], { initializer: "initialize", kind: "uups" });
  await treasury.waitForDeployment();
  const treasuryAddr = await treasury.getAddress();
  console.log("✓ TreasuryVault:", treasuryAddr);

  // ── 3. Game Registry ──────────────────────────────────────────────────────
  console.log("\n[3/15] Deploying GameRegistry...");
  const GameRegistry = await ethers.getContractFactory("GameRegistry");
  const registry = await upgrades.deployProxy(GameRegistry, [admin], { initializer: "initialize", kind: "uups" });
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("✓ GameRegistry:", registryAddr);

  // ── 4. Randomness Coordinator ─────────────────────────────────────────────
  console.log("\n[4/15] Deploying RandomnessCoordinator...");
  const RandomnessCoordinator = await ethers.getContractFactory("RandomnessCoordinator");
  const coordinator = await upgrades.deployProxy(
    RandomnessCoordinator,
    [admin, vrfCoordinatorAddr, keyHash, subscriptionId],
    { initializer: "initialize", kind: "uups" }
  );
  await coordinator.waitForDeployment();
  const coordinatorAddr = await coordinator.getAddress();
  console.log("✓ RandomnessCoordinator:", coordinatorAddr);

  // Helper to deploy a game proxy
  async function deployGame(name: string, idx: number, args: unknown[]) {
    console.log(`\n[${idx}/15] Deploying ${name}...`);
    const Factory = await ethers.getContractFactory(name);
    const proxy = await upgrades.deployProxy(Factory, args, { initializer: "initialize", kind: "uups" });
    await proxy.waitForDeployment();
    const addr = await proxy.getAddress();
    console.log(`✓ ${name}:`, addr);
    return { proxy, addr };
  }

  const gameArgs = [admin, treasuryAddr, coordinatorAddr, minStake, maxStake];

  // ── 5–15. Game Contracts ──────────────────────────────────────────────────
  const { addr: coinFlipAddr } = await deployGame("CoinFlipGame", 5, gameArgs);
  const { addr: diceAddr }     = await deployGame("DiceGame",     6, gameArgs);
  const { addr: limboAddr }    = await deployGame("LimboGame",    7, gameArgs);
  const { addr: crashAddr }    = await deployGame("CrashGame",    8, gameArgs);
  const { addr: wheelAddr }    = await deployGame("WheelGame",    9, gameArgs);
  const { addr: rouletteAddr } = await deployGame("RouletteGame", 10, gameArgs);
  const { addr: plinkoAddr }   = await deployGame("PlinkoGame",   11, gameArgs);
  const { addr: kenoAddr }     = await deployGame("KenoGame",     12, gameArgs);
  const { addr: minesAddr }    = await deployGame("MinesGame",    13, gameArgs);
  const { addr: blackjackAddr }= await deployGame("BlackjackGame",14, gameArgs);
  const { addr: hiloAddr }     = await deployGame("HiloGame",     15, gameArgs);

  const gameAddresses = [
    coinFlipAddr, diceAddr, limboAddr, crashAddr, wheelAddr,
    rouletteAddr, plinkoAddr, kenoAddr, minesAddr, blackjackAddr, hiloAddr,
  ];
  const gameNames = [
    "COINFLIP", "DICE", "LIMBO", "CRASH", "WHEEL",
    "ROULETTE", "PLINKO", "KENO", "MINES", "BLACKJACK", "HILO",
  ];

  // ── Wire up roles ─────────────────────────────────────────────────────────
  console.log("\n[Setup] Granting GAME_ROLE and registering games...");
  const GAME_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GAME_ROLE"));

  for (let i = 0; i < gameAddresses.length; i++) {
    await (treasury as any).grantRole(GAME_ROLE, gameAddresses[i]);
    await (coordinator as any).grantRole(GAME_ROLE, gameAddresses[i]);
    const gameId = ethers.keccak256(ethers.toUtf8Bytes(gameNames[i]));
    await (registry as any).registerGame(gameId, gameAddresses[i]);
    console.log(`  ✓ ${gameNames[i]} roles + registry`);
  }

  // ── Seed treasury bankroll (local only) ───────────────────────────────────
  if (isLocal) {
    console.log("\n[Seed] Minting bankroll to treasury...");
    const GZOFactory = await ethers.getContractFactory("GZOToken");
    const gzoToken = GZOFactory.attach(gzoAddr);
    const bankroll = ethers.parseEther("1000000");
    await (gzoToken as any).mint(admin, bankroll);
    await (gzoToken as any).approve(treasuryAddr, bankroll);
    await (treasury as any).depositBankroll(bankroll);
    console.log("✓ Treasury funded with 1,000,000 GZO");
  }

  // ── Write address manifest ────────────────────────────────────────────────
  const addresses: DeployedAddresses = {
    network: network.name,
    chainId: Number(network.chainId),
    deployedAt: new Date().toISOString(),
    gzoToken: gzoAddr,
    treasuryVault: treasuryAddr,
    gameRegistry: registryAddr,
    randomnessCoordinator: coordinatorAddr,
    ...(mockVRFAddr ? { mockVRFCoordinator: mockVRFAddr } : {}),
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
  console.log("\n✅ Addresses written to:", manifestPath);

  const frontendPath = path.join(__dirname, "../../src/lib/web3/deployed-addresses.json");
  fs.mkdirSync(path.dirname(frontendPath), { recursive: true });
  fs.writeFileSync(frontendPath, JSON.stringify(addresses, null, 2));
  console.log("✅ Frontend config updated:", frontendPath);

  console.log("\n─────────────────────────────────────────");
  console.log("Deployment complete — 11 games deployed");
  console.log("TreasuryVault:", treasuryAddr);
  console.log("\n⚠️  NEXT STEPS (testnet only):");
  console.log("  1. Add RandomnessCoordinator as VRF consumer on vrf.chain.link:");
  console.log("     Consumer address:", coordinatorAddr);
  console.log("  2. Fund TreasuryVault with GZO bankroll:");
  console.log("     gzoToken.approve(" + treasuryAddr + ", AMOUNT)");
  console.log("     treasury.depositBankroll(AMOUNT)");
  console.log("─────────────────────────────────────────");
}

main().catch((err) => { console.error(err); process.exit(1); });
