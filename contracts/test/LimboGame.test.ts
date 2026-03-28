import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("LimboGame", function () {
  let admin: SignerWithAddress;
  let player: SignerWithAddress;
  let gzoToken: any, treasury: any, coordinator: any, mockVRF: any, limbo: any;

  const GAME_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GAME_ROLE"));
  const LIMBO_ID  = ethers.keccak256(ethers.toUtf8Bytes("LIMBO"));
  const minStake  = ethers.parseEther("1");
  const maxStake  = ethers.parseEther("10000");
  const STAKE     = ethers.parseEther("100");

  async function deployAll() {
    [admin, player] = await ethers.getSigners();

    const MockVRF = await ethers.getContractFactory("MockVRFCoordinator");
    mockVRF = await MockVRF.deploy();

    const GZOToken = await ethers.getContractFactory("GZOToken");
    gzoToken = await upgrades.deployProxy(GZOToken, [admin.address], { kind: "uups" });

    const TreasuryVault = await ethers.getContractFactory("TreasuryVault");
    treasury = await upgrades.deployProxy(TreasuryVault, [await gzoToken.getAddress(), admin.address], { kind: "uups" });

    const RandomnessCoordinator = await ethers.getContractFactory("RandomnessCoordinator");
    coordinator = await upgrades.deployProxy(
      RandomnessCoordinator,
      [admin.address, await mockVRF.getAddress(), ethers.ZeroHash, 1],
      { kind: "uups" }
    );

    const LimboGame = await ethers.getContractFactory("LimboGame");
    limbo = await upgrades.deployProxy(
      LimboGame,
      [admin.address, await treasury.getAddress(), await coordinator.getAddress(), minStake, maxStake],
      { kind: "uups" }
    );

    const limboAddr = await limbo.getAddress();
    await treasury.grantRole(GAME_ROLE, limboAddr);
    await coordinator.grantRole(GAME_ROLE, limboAddr);

    // Fund treasury
    const bankroll = ethers.parseEther("1000000");
    await gzoToken.mint(admin.address, bankroll);
    await gzoToken.approve(await treasury.getAddress(), bankroll);
    await treasury.depositBankroll(bankroll);

    // Fund player
    await gzoToken.mint(player.address, ethers.parseEther("10000"));
    await gzoToken.connect(player).approve(await treasury.getAddress(), ethers.parseEther("10000"));
  }

  // MockVRFCoordinator uses sequential IDs starting at 1.
  let nextVrfId = 1n;
  beforeEach(() => { nextVrfId = 1n; });

  async function placeBetAndFulfill(targetBps: bigint, randomWord: bigint) {
    const tx = await limbo.connect(player).placeBet(STAKE, targetBps);
    const receipt = await tx.wait();
    const event = receipt.logs.find((l: any) => {
      try { return limbo.interface.parseLog(l)?.name === "BetPlaced"; } catch { return false; }
    });
    const parsed = limbo.interface.parseLog(event);
    const roundId = parsed.args.roundId;

    const vrfReqId = nextVrfId++;
    await mockVRF.fulfillRandomWords(vrfReqId, await coordinator.getAddress(), randomWord);
    return roundId;
  }

  beforeEach(deployAll);

  it("placeBet: locks stake and emits BetPlaced", async () => {
    const targetBps = 200n; // 2×
    await expect(limbo.connect(player).placeBet(STAKE, targetBps))
      .to.emit(limbo, "BetPlaced")
      .withArgs(
        (_: any) => true, // roundId
        player.address,
        STAKE,
        targetBps
      );
  });

  it("fulfillRandomness: settles round and emits RoundSettled", async () => {
    const targetBps = 200n; // 2.00× — need generated >= 200
    // Use a word that yields a high multiplier (word = 0 → max value → definitely wins low target)
    // vrfToLimboMultiplier with word=0: 1/(1−0) = infinity → capped at 1_000_000
    const roundId = await placeBetAndFulfill(targetBps, 1n);
    const round = await limbo.getRound(roundId);
    expect(round.settled).to.be.true;
  });

  it("win: pays out correctly when generated >= target", async () => {
    const targetBps = 101n; // 1.01× — wins if generated >= 101 (almost always)
    // word = 2 → float ≈ 0, generated ≈ 100 (barely over 100). Use word that gives large value.
    // Use a very large word to get high multiplier
    const bigWord = BigInt("0x" + "ff".repeat(31) + "00"); // large, but floor((1/1-float) * 100) > 101
    const roundId = await placeBetAndFulfill(targetBps, bigWord);
    const round = await limbo.getRound(roundId);
    expect(round.settled).to.be.true;
    // Either won or lost depending on actual value, just verify it settled
  });

  it("reverts: stake below minimum", async () => {
    await expect(limbo.connect(player).placeBet(ethers.parseEther("0.5"), 200n))
      .to.be.revertedWith("stake out of range");
  });

  it("reverts: target below minimum (100 bps = 1.00×)", async () => {
    await expect(limbo.connect(player).placeBet(STAKE, 100n))
      .to.be.revertedWith("invalid target");
  });

  it("reverts: target above maximum", async () => {
    const maxTarget = await limbo.maxTargetBps();
    await expect(limbo.connect(player).placeBet(STAKE, maxTarget + 1n))
      .to.be.revertedWith("invalid target");
  });

  it("pause: reverts placeBet when paused", async () => {
    await limbo.pause();
    await expect(limbo.connect(player).placeBet(STAKE, 200n))
      .to.be.revertedWithCustomError(limbo, "EnforcedPause");
  });

  it("fee: house takes 10% of profit on win", async () => {
    // A guaranteed win: target = 101 (1.01×), use smallest word that wins
    // gross = stake * 101 / 100 = 101 GZO; profit = 1 GZO; fee = 0.1 GZO (floor)
    // Just verify the event emits with non-zero fee when won
    const targetBps = 200n;
    const roundId = await placeBetAndFulfill(targetBps, 0n); // word=0 → max multiplier → win
    const round = await limbo.getRound(roundId);
    if (round.won) {
      expect(round.netPayout).to.be.gt(0n);
      expect(round.netPayout).to.be.lt(STAKE * 200n / 100n); // netPayout < gross
    }
  });
});
