import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("CoinFlipGame", function () {
  let admin: SignerWithAddress;
  let playerA: SignerWithAddress;
  let playerB: SignerWithAddress;
  let gzoToken: any;
  let treasury: any;
  let registry: any;
  let coordinator: any;
  let mockVRF: any;
  let coinFlip: any;

  const minStake = ethers.parseEther("1");
  const maxStake = ethers.parseEther("10000");
  const STAKE    = ethers.parseEther("100");
  const GAME_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GAME_ROLE"));
  const COINFLIP_ID = ethers.keccak256(ethers.toUtf8Bytes("COINFLIP"));

  beforeEach(async () => {
    [admin, playerA, playerB] = await ethers.getSigners();

    // Deploy mock VRF
    const MockVRF = await ethers.getContractFactory("MockVRFCoordinator");
    mockVRF = await MockVRF.deploy();

    // Deploy GZO Token
    const GZOToken = await ethers.getContractFactory("GZOToken");
    gzoToken = await upgrades.deployProxy(GZOToken, [admin.address], { kind: "uups" });

    // Deploy Treasury
    const TreasuryVault = await ethers.getContractFactory("TreasuryVault");
    treasury = await upgrades.deployProxy(TreasuryVault, [await gzoToken.getAddress(), admin.address], { kind: "uups" });

    // Deploy Registry
    const GameRegistry = await ethers.getContractFactory("GameRegistry");
    registry = await upgrades.deployProxy(GameRegistry, [admin.address], { kind: "uups" });

    // Deploy Coordinator
    const RandomnessCoordinator = await ethers.getContractFactory("RandomnessCoordinator");
    coordinator = await upgrades.deployProxy(
      RandomnessCoordinator,
      [admin.address, await mockVRF.getAddress(), ethers.ZeroHash, 1],
      { kind: "uups" }
    );

    // Deploy CoinFlip
    const CoinFlipGame = await ethers.getContractFactory("CoinFlipGame");
    coinFlip = await upgrades.deployProxy(
      CoinFlipGame,
      [admin.address, await treasury.getAddress(), await coordinator.getAddress(), minStake, maxStake],
      { kind: "uups" }
    );

    const coinFlipAddr = await coinFlip.getAddress();
    const coordinatorAddr = await coordinator.getAddress();
    const treasuryAddr = await treasury.getAddress();

    // Grant roles
    await treasury.grantRole(GAME_ROLE, coinFlipAddr);
    await coordinator.grantRole(GAME_ROLE, coinFlipAddr);
    await registry.registerGame(COINFLIP_ID, coinFlipAddr);

    // Mint GZO to players and treasury
    const SUPPLY = ethers.parseEther("1000000");
    await gzoToken.mint(admin.address, SUPPLY);
    await gzoToken.mint(playerA.address, ethers.parseEther("10000"));
    await gzoToken.mint(playerB.address, ethers.parseEther("10000"));

    // Fund treasury bankroll
    await gzoToken.approve(treasuryAddr, SUPPLY);
    await treasury.depositBankroll(SUPPLY);

    // Approve treasury for players
    await gzoToken.connect(playerA).approve(treasuryAddr, ethers.parseEther("10000"));
    await gzoToken.connect(playerB).approve(treasuryAddr, ethers.parseEther("10000"));
  });

  it("deploys with correct state", async () => {
    expect(await coinFlip.minStake()).to.equal(minStake);
    expect(await coinFlip.maxStake()).to.equal(maxStake);
    expect(await coinFlip.gameName()).to.equal("Coin Flip");
    expect(await coinFlip.gameId()).to.equal(COINFLIP_ID);
  });

  it("player A can create a match", async () => {
    const tx = await coinFlip.connect(playerA).createMatch(STAKE, 0); // 0 = HEADS
    const receipt = await tx.wait();
    const event = receipt?.logs.find((l: any) => {
      try { return coinFlip.interface.parseLog(l)?.name === "MatchCreated"; } catch { return false; }
    });
    expect(event).to.not.be.undefined;

    const parsed = coinFlip.interface.parseLog(event!);
    const roundId = parsed?.args.roundId;
    const match = await coinFlip.getMatch(roundId);
    expect(match.playerA).to.equal(playerA.address);
    expect(match.stake).to.equal(STAKE);
    expect(match.status).to.equal(0); // PENDING
  });

  it("player B joins and VRF settles the match", async () => {
    // Create
    const createTx = await coinFlip.connect(playerA).createMatch(STAKE, 0); // HEADS
    const createReceipt = await createTx.wait();
    const createEvent = createReceipt?.logs.find((l: any) => {
      try { return coinFlip.interface.parseLog(l)?.name === "MatchCreated"; } catch { return false; }
    });
    const roundId = coinFlip.interface.parseLog(createEvent!)?.args.roundId;

    const playerABefore = await gzoToken.balanceOf(playerA.address);
    const playerBBefore = await gzoToken.balanceOf(playerB.address);

    // Join
    const joinTx = await coinFlip.connect(playerB).joinMatch(roundId);
    const joinReceipt = await joinTx.wait();
    const joinEvent = joinReceipt?.logs.find((l: any) => {
      try { return coinFlip.interface.parseLog(l)?.name === "MatchJoined"; } catch { return false; }
    });
    const vrfRequestId = coinFlip.interface.parseLog(joinEvent!)?.args.vrfRequestId;

    // Fulfill VRF with an even number → HEADS → Player A wins
    const coordinatorAddr = await coordinator.getAddress();
    await mockVRF.fulfillRandomWords(vrfRequestId, coordinatorAddr, 2); // even = HEADS

    const match = await coinFlip.getMatch(roundId);
    expect(match.status).to.equal(2); // SETTLED
    expect(match.winner).to.equal(playerA.address);

    // Player A should have received netPayout = 2×stake - fee (10% of profit=stake)
    // playerABefore was captured AFTER createMatch (stake already pulled), so:
    // playerAAfter - playerABefore == netPayout == 2*stake - 0.1*stake == 1.9*stake
    const playerAAfter = await gzoToken.balanceOf(playerA.address);
    const netPayout = STAKE * 2n - STAKE / 10n; // 190 GZO for 100 GZO stake
    expect(playerAAfter - playerABefore).to.be.closeTo(netPayout, ethers.parseEther("1"));
  });

  it("player A can cancel a PENDING match", async () => {
    const tx = await coinFlip.connect(playerA).createMatch(STAKE, 0);
    const receipt = await tx.wait();
    const event = receipt?.logs.find((l: any) => {
      try { return coinFlip.interface.parseLog(l)?.name === "MatchCreated"; } catch { return false; }
    });
    const roundId = coinFlip.interface.parseLog(event!)?.args.roundId;

    const balanceBefore = await gzoToken.balanceOf(playerA.address);
    await coinFlip.connect(playerA).cancelMatch(roundId);
    const balanceAfter = await gzoToken.balanceOf(playerA.address);

    expect(balanceAfter - balanceBefore).to.equal(STAKE);
    const match = await coinFlip.getMatch(roundId);
    expect(match.status).to.equal(3); // CANCELLED
  });

  it("stake out of range reverts", async () => {
    await expect(coinFlip.connect(playerA).createMatch(0, 0)).to.be.revertedWith("stake out of range");
    await expect(coinFlip.connect(playerA).createMatch(ethers.parseEther("100000"), 0)).to.be.revertedWith("stake out of range");
  });

  it("player A cannot join own match", async () => {
    const tx = await coinFlip.connect(playerA).createMatch(STAKE, 0);
    const receipt = await tx.wait();
    const event = receipt?.logs.find((l: any) => {
      try { return coinFlip.interface.parseLog(l)?.name === "MatchCreated"; } catch { return false; }
    });
    const roundId = coinFlip.interface.parseLog(event!)?.args.roundId;
    await expect(coinFlip.connect(playerA).joinMatch(roundId)).to.be.revertedWith("cannot join own match");
  });

  it("is upgradeable", async () => {
    const CoinFlipV2 = await ethers.getContractFactory("CoinFlipGame");
    const upgraded = await upgrades.upgradeProxy(await coinFlip.getAddress(), CoinFlipV2, { kind: "uups" });
    expect(await upgraded.gameName()).to.equal("Coin Flip");
  });
});
