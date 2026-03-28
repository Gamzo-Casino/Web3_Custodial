import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("DiceGame", function () {
  let admin: SignerWithAddress;
  let player: SignerWithAddress;
  let gzoToken: any, treasury: any, coordinator: any, mockVRF: any, dice: any;

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

    const DiceGame = await ethers.getContractFactory("DiceGame");
    dice = await upgrades.deployProxy(
      DiceGame,
      [admin.address, await treasury.getAddress(), await coordinator.getAddress(), minStake, maxStake],
      { kind: "uups" }
    );

    await treasury.grantRole(GAME_ROLE, await dice.getAddress());
    await coordinator.grantRole(GAME_ROLE, await dice.getAddress());

    const bankroll = ethers.parseEther("1000000");
    await gzoToken.mint(admin.address, bankroll);
    await gzoToken.approve(await treasury.getAddress(), bankroll);
    await treasury.depositBankroll(bankroll);

    await gzoToken.mint(player.address, ethers.parseEther("10000"));
    await gzoToken.connect(player).approve(await treasury.getAddress(), ethers.parseEther("10000"));
  });

  let nextVrfId = 1n;
  beforeEach(() => { nextVrfId = 1n; });

  async function bet(targetScaled: bigint, randomWord: bigint) {
    const tx = await dice.connect(player).placeBet(STAKE, targetScaled);
    const receipt = await tx.wait();
    const event = receipt.logs.find((l: any) => {
      try { return dice.interface.parseLog(l)?.name === "BetPlaced"; } catch { return false; }
    });
    const parsed = dice.interface.parseLog(event);
    const roundId = parsed.args.roundId;
    const vrfReqId = nextVrfId++;
    await mockVRF.fulfillRandomWords(vrfReqId, await coordinator.getAddress(), randomWord);
    return roundId;
  }

  it("placeBet: emits BetPlaced with correct args", async () => {
    const targetScaled = 5000n; // 50.00
    await expect(dice.connect(player).placeBet(STAKE, targetScaled))
      .to.emit(dice, "BetPlaced")
      .withArgs((_: any) => true, player.address, STAKE, targetScaled);
  });

  it("win path: roll < target pays out, no double-settlement", async () => {
    // targetScaled = 9800 (98.00), word = 0 → roll = 0 < 9800 → WIN
    const roundId = await bet(9800n, 0n);
    const round = await dice.getRound(roundId);
    expect(round.settled).to.be.true;
    expect(round.won).to.be.true;
    expect(round.netPayout).to.be.gt(0n);
  });

  it("lose path: roll >= target absorbs stake, no payout", async () => {
    // targetScaled = 101 (1.01), word = max → roll = 9999 >= 101 → LOSE
    const maxWord = ethers.MaxUint256;
    const roundId = await bet(101n, maxWord);
    const round = await dice.getRound(roundId);
    expect(round.settled).to.be.true;
    expect(round.won).to.be.false;
    expect(round.netPayout).to.equal(0n);
  });

  it("fee: net payout < gross on win", async () => {
    // target = 9800, gross = stake * 9900 / 9800 ≈ 101.02 GZO; fee = 10% of profit
    const roundId = await bet(9800n, 0n);
    const round = await dice.getRound(roundId);
    const expectedGross = STAKE * 9900n / 9800n;
    expect(round.netPayout).to.be.lt(expectedGross);
    expect(round.netPayout).to.be.gt(STAKE); // must be at least returning stake
  });

  it("reverts: stake below minimum", async () => {
    await expect(dice.connect(player).placeBet(ethers.parseEther("0.1"), 5000n))
      .to.be.revertedWith("stake out of range");
  });

  it("reverts: targetScaled out of range (too high)", async () => {
    await expect(dice.connect(player).placeBet(STAKE, 9801n))
      .to.be.revertedWith("invalid target");
  });

  it("reverts: targetScaled out of range (too low)", async () => {
    await expect(dice.connect(player).placeBet(STAKE, 100n))
      .to.be.revertedWith("invalid target");
  });

  it("pause: blocks placeBet", async () => {
    await dice.pause();
    await expect(dice.connect(player).placeBet(STAKE, 5000n))
      .to.be.revertedWithCustomError(dice, "EnforcedPause");
  });
});
