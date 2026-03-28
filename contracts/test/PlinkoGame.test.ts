import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("PlinkoGame", function () {
  let admin: SignerWithAddress;
  let player: SignerWithAddress;
  let gzoToken: any, treasury: any, coordinator: any, mockVRF: any, plinko: any;

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

    const PlinkoGame = await ethers.getContractFactory("PlinkoGame");
    plinko = await upgrades.deployProxy(
      PlinkoGame,
      [admin.address, await treasury.getAddress(), await coordinator.getAddress(), minStake, maxStake],
      { kind: "uups" }
    );

    await treasury.grantRole(GAME_ROLE, await plinko.getAddress());
    await coordinator.grantRole(GAME_ROLE, await plinko.getAddress());

    const bankroll = ethers.parseEther("1000000");
    await gzoToken.mint(admin.address, bankroll);
    await gzoToken.approve(await treasury.getAddress(), bankroll);
    await treasury.depositBankroll(bankroll);

    await gzoToken.mint(player.address, ethers.parseEther("10000"));
    await gzoToken.connect(player).approve(await treasury.getAddress(), ethers.parseEther("10000"));
  });

  let nextVrfId = 1n;
  beforeEach(() => { nextVrfId = 1n; });

  async function dropBall(rows: 8 | 12 | 16, risk: 0 | 1 | 2, randomWord: bigint) {
    const tx = await plinko.connect(player).dropBall(STAKE, rows, risk);
    const receipt = await tx.wait();
    const event = receipt.logs.find((l: any) => {
      try { return plinko.interface.parseLog(l)?.name === "BetPlaced"; } catch { return false; }
    });
    const parsed = plinko.interface.parseLog(event);
    const roundId = parsed.args.roundId;
    const vrfReqId = nextVrfId++;
    await mockVRF.fulfillRandomWords(vrfReqId, await coordinator.getAddress(), randomWord);
    return roundId;
  }

  it("dropBall: emits BetPlaced", async () => {
    await expect(plinko.connect(player).dropBall(STAKE, 8, 0))
      .to.emit(plinko, "BetPlaced")
      .withArgs((_: any) => true, player.address, STAKE, 8, 0);
  });

  it("fulfillRandomness: settles round", async () => {
    const roundId = await dropBall(8, 0, 0n);
    const round = await plinko.getRound(roundId);
    expect(round.settled).to.be.true;
  });

  it("binIndex is within valid range for 8 rows", async () => {
    const roundId = await dropBall(8, 0, 12345n);
    const round = await plinko.getRound(roundId);
    expect(Number(round.rows)).to.equal(8);
    expect(Number(round.binIndex)).to.be.gte(0);
    expect(Number(round.binIndex)).to.be.lte(8); // 8 rows → 9 bins (0-8)
  });

  it("binIndex is within valid range for 16 rows", async () => {
    const roundId = await dropBall(16, 2, 99999n);
    const round = await plinko.getRound(roundId);
    expect(Number(round.rows)).to.equal(16);
    expect(Number(round.binIndex)).to.be.gte(0);
    expect(Number(round.binIndex)).to.be.lte(16);
  });

  it("multiplier100 is non-zero", async () => {
    const roundId = await dropBall(8, 0, 42n);
    const round = await plinko.getRound(roundId);
    expect(round.multiplier100).to.be.gt(0n);
  });

  it("payout equals stake * multiplier100 / 100 (minus fee on profit)", async () => {
    const roundId = await dropBall(8, 0, 0n);
    const round = await plinko.getRound(roundId);
    const gross = STAKE * round.multiplier100 / 100n;
    // netPayout = gross - fee where fee = 10% of (gross - stake) if gross > stake
    if (gross > STAKE) {
      const profit = gross - STAKE;
      const fee = profit / 10n;
      expect(round.netPayout).to.equal(gross - fee);
    } else {
      expect(round.netPayout).to.equal(gross);
    }
  });

  it("supports rows=12 and risk=1 (medium)", async () => {
    const roundId = await dropBall(12, 1, 777n);
    const round = await plinko.getRound(roundId);
    expect(round.settled).to.be.true;
    expect(Number(round.rows)).to.equal(12);
    expect(Number(round.risk)).to.equal(1);
  });

  it("reverts: invalid rows value", async () => {
    await expect(plinko.connect(player).dropBall(STAKE, 10, 0))
      .to.be.revertedWith("invalid rows");
  });

  it("reverts: invalid risk value", async () => {
    await expect(plinko.connect(player).dropBall(STAKE, 8, 3))
      .to.be.revertedWith("invalid risk");
  });

  it("reverts: stake below minimum", async () => {
    await expect(plinko.connect(player).dropBall(ethers.parseEther("0.5"), 8, 0))
      .to.be.revertedWith("stake out of range");
  });

  it("pause: blocks dropBall", async () => {
    await plinko.pause();
    await expect(plinko.connect(player).dropBall(STAKE, 8, 0))
      .to.be.revertedWithCustomError(plinko, "EnforcedPause");
  });
});
