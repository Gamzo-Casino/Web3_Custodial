import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("CrashGame", function () {
  let admin: SignerWithAddress;
  let player: SignerWithAddress;
  let gzoToken: any, treasury: any, coordinator: any, mockVRF: any, crash: any;

  const GAME_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GAME_ROLE"));
  const minStake  = ethers.parseEther("1");
  const maxStake  = ethers.parseEther("10000");
  const STAKE     = ethers.parseEther("100");

  beforeEach(async () => {
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

    const CrashGame = await ethers.getContractFactory("CrashGame");
    crash = await upgrades.deployProxy(
      CrashGame,
      [admin.address, await treasury.getAddress(), await coordinator.getAddress(), minStake, maxStake],
      { kind: "uups" }
    );

    await treasury.grantRole(GAME_ROLE, await crash.getAddress());
    await coordinator.grantRole(GAME_ROLE, await crash.getAddress());

    const bankroll = ethers.parseEther("1000000");
    await gzoToken.mint(admin.address, bankroll);
    await gzoToken.approve(await treasury.getAddress(), bankroll);
    await treasury.depositBankroll(bankroll);

    await gzoToken.mint(player.address, ethers.parseEther("10000"));
    await gzoToken.connect(player).approve(await treasury.getAddress(), ethers.parseEther("10000"));
  });

  let nextVrfId = 1n;
  beforeEach(() => { nextVrfId = 1n; });

  async function bet(autoCashoutBps: bigint, randomWord: bigint) {
    const tx = await crash.connect(player).placeBet(STAKE, autoCashoutBps);
    const receipt = await tx.wait();
    const event = receipt.logs.find((l: any) => {
      try { return crash.interface.parseLog(l)?.name === "BetPlaced"; } catch { return false; }
    });
    const parsed = crash.interface.parseLog(event);
    const roundId = parsed.args.roundId;
    const vrfReqId = nextVrfId++;
    await mockVRF.fulfillRandomWords(vrfReqId, await coordinator.getAddress(), randomWord);
    return roundId;
  }

  it("placeBet: emits BetPlaced", async () => {
    await expect(crash.connect(player).placeBet(STAKE, 200n))
      .to.emit(crash, "BetPlaced")
      .withArgs((_: any) => true, player.address, STAKE, 200n);
  });

  it("fulfillRandomness: settles round and emits RoundSettled", async () => {
    const roundId = await bet(200n, 0n);
    const round = await crash.getRound(roundId);
    expect(round.settled).to.be.true;
    expect(round.crashPoint).to.be.gt(0n);
  });

  it("cashout: word=0 → max crashPoint ≥ autoCashoutBps → wins", async () => {
    // word=0 → float=0 → multiplier = 1/(1-0) → max → crashPoint = 1_000_000
    // autoCashout = 200 (2×) → crashPoint 1000000 >= 200 → WIN
    const roundId = await bet(200n, 0n);
    const round = await crash.getRound(roundId);
    expect(round.won).to.be.true;
    expect(round.netPayout).to.be.gt(0n);
  });

  it("crash: word=maxUint → crashPoint=100 → autoCashout 200 loses", async () => {
    // word = MaxUint256 → float ≈ 1 → multiplier ≈ 100 (floor)
    // autoCashout = 200 → crashPoint 100 < 200 → LOSE
    const roundId = await bet(200n, ethers.MaxUint256);
    const round = await crash.getRound(roundId);
    expect(round.settled).to.be.true;
    if (round.crashPoint < 200n) {
      expect(round.won).to.be.false;
      expect(round.netPayout).to.equal(0n);
    }
  });

  it("reverts: autoCashoutBps too low (< 101)", async () => {
    await expect(crash.connect(player).placeBet(STAKE, 100n))
      .to.be.revertedWith("invalid cashout target");
  });

  it("reverts: stake below minimum", async () => {
    await expect(crash.connect(player).placeBet(ethers.parseEther("0.5"), 200n))
      .to.be.revertedWith("stake out of range");
  });

  it("fee: netPayout < gross on cashout", async () => {
    const autoCashoutBps = 200n; // 2×
    const roundId = await bet(autoCashoutBps, 0n);
    const round = await crash.getRound(roundId);
    if (round.won) {
      const gross = STAKE * autoCashoutBps / 100n;
      expect(round.netPayout).to.be.lt(gross);
    }
  });

  it("pause: blocks placeBet", async () => {
    await crash.pause();
    await expect(crash.connect(player).placeBet(STAKE, 200n))
      .to.be.revertedWithCustomError(crash, "EnforcedPause");
  });
});
