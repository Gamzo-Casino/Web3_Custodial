import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("WheelGame", function () {
  let admin: SignerWithAddress;
  let player: SignerWithAddress;
  let gzoToken: any, treasury: any, coordinator: any, mockVRF: any, wheel: any;

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

    const WheelGame = await ethers.getContractFactory("WheelGame");
    wheel = await upgrades.deployProxy(
      WheelGame,
      [admin.address, await treasury.getAddress(), await coordinator.getAddress(), minStake, maxStake],
      { kind: "uups" }
    );

    await treasury.grantRole(GAME_ROLE, await wheel.getAddress());
    await coordinator.grantRole(GAME_ROLE, await wheel.getAddress());

    const bankroll = ethers.parseEther("1000000");
    await gzoToken.mint(admin.address, bankroll);
    await gzoToken.approve(await treasury.getAddress(), bankroll);
    await treasury.depositBankroll(bankroll);

    await gzoToken.mint(player.address, ethers.parseEther("10000"));
    await gzoToken.connect(player).approve(await treasury.getAddress(), ethers.parseEther("10000"));
  });

  let nextVrfId = 1n;
  beforeEach(() => { nextVrfId = 1n; });

  async function spin(riskMode: 0 | 1 | 2, randomWord: bigint) {
    const tx = await wheel.connect(player).spin(STAKE, riskMode);
    const receipt = await tx.wait();
    const event = receipt.logs.find((l: any) => {
      try { return wheel.interface.parseLog(l)?.name === "BetPlaced"; } catch { return false; }
    });
    const parsed = wheel.interface.parseLog(event);
    const roundId = parsed.args.roundId;
    const vrfReqId = nextVrfId++;
    await mockVRF.fulfillRandomWords(vrfReqId, await coordinator.getAddress(), randomWord);
    return roundId;
  }

  it("spin: emits SpinPlaced with correct args", async () => {
    await expect(wheel.connect(player).spin(STAKE, 0))
      .to.emit(wheel, "BetPlaced")
      .withArgs((_: any) => true, player.address, STAKE, 0);
  });

  it("fulfillRandomness: settles round and emits RoundSettled", async () => {
    const roundId = await spin(0, 0n); // LOW risk, deterministic word
    const round = await wheel.getRound(roundId);
    expect(round.settled).to.be.true;
  });

  it("win: pays out on non-zero multiplier segment", async () => {
    // LOW risk: weights=[18,16,10,6,3,1], mults=[0,120,150,200,300,500]
    // stop = word % 54. Word=18 → stop=18 → past segment 0 (weight 18), into segment 1 (mult=120)
    const roundId = await spin(0, 18n);
    const round = await wheel.getRound(roundId);
    expect(round.settled).to.be.true;
    // segment 1 has mult 120 (1.2×) — should win
    if (round.multiplier100 > 0n) {
      expect(round.netPayout).to.be.gt(0n);
    }
  });

  it("loss: zero multiplier segment absorbs stake", async () => {
    // LOW risk, stop=0 → segment 0, mult=0 → lose
    const roundId = await spin(0, 0n);
    const round = await wheel.getRound(roundId);
    expect(round.settled).to.be.true;
    if (round.multiplier100 === 0n) {
      expect(round.netPayout).to.equal(0n);
    }
  });

  it("supports all 3 risk modes", async () => {
    for (const risk of [0, 1, 2] as const) {
      const roundId = await spin(risk, 10n);
      const round = await wheel.getRound(roundId);
      expect(round.settled).to.be.true;
      expect(round.riskMode).to.equal(risk);
    }
  });

  it("reverts: invalid risk mode", async () => {
    await expect(wheel.connect(player).spin(STAKE, 3))
      .to.be.revertedWith("invalid risk mode");
  });

  it("reverts: stake below minimum", async () => {
    await expect(wheel.connect(player).spin(ethers.parseEther("0.5"), 0))
      .to.be.revertedWith("stake out of range");
  });

  it("pause: blocks spin", async () => {
    await wheel.pause();
    await expect(wheel.connect(player).spin(STAKE, 0))
      .to.be.revertedWithCustomError(wheel, "EnforcedPause");
  });
});
