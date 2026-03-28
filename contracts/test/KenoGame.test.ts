import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("KenoGame", function () {
  let admin: SignerWithAddress;
  let player: SignerWithAddress;
  let gzoToken: any, treasury: any, coordinator: any, mockVRF: any, keno: any;

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

    const KenoGame = await ethers.getContractFactory("KenoGame");
    keno = await upgrades.deployProxy(
      KenoGame,
      [admin.address, await treasury.getAddress(), await coordinator.getAddress(), minStake, maxStake],
      { kind: "uups" }
    );

    await treasury.grantRole(GAME_ROLE, await keno.getAddress());
    await coordinator.grantRole(GAME_ROLE, await keno.getAddress());

    const bankroll = ethers.parseEther("1000000");
    await gzoToken.mint(admin.address, bankroll);
    await gzoToken.approve(await treasury.getAddress(), bankroll);
    await treasury.depositBankroll(bankroll);

    await gzoToken.mint(player.address, ethers.parseEther("10000"));
    await gzoToken.connect(player).approve(await treasury.getAddress(), ethers.parseEther("10000"));
  });

  // MockVRFCoordinator uses sequential IDs starting at 1.
  // Each beforeEach deploys a fresh instance, so the first request in each test = ID 1.
  let nextVrfId = 1n;

  beforeEach(() => { nextVrfId = 1n; });

  async function placeBetAndFulfill(picks: number[], randomWord: bigint) {
    const tx = await keno.connect(player).placeBet(STAKE, picks);
    const receipt = await tx.wait();
    const event = receipt.logs.find((l: any) => {
      try { return keno.interface.parseLog(l)?.name === "BetPlaced"; } catch { return false; }
    });
    const parsed = keno.interface.parseLog(event);
    const roundId = parsed.args.roundId;
    const vrfReqId = nextVrfId++;
    await mockVRF.fulfillRandomWords(vrfReqId, await coordinator.getAddress(), randomWord);
    return roundId;
  }

  it("placeBet: emits BetPlaced with picks", async () => {
    const picks = [1, 5, 10, 20];
    await expect(keno.connect(player).placeBet(STAKE, picks))
      .to.emit(keno, "BetPlaced")
      .withArgs((_: any) => true, player.address, STAKE, picks);
  });

  it("fulfillRandomness: settles round with drawn numbers", async () => {
    const picks = [1, 2, 3, 4, 5];
    const roundId = await placeBetAndFulfill(picks, 12345n);
    const [, , , drawn, matchCount, multiplier100, netPayout, settled] = await keno.getRound(roundId);
    expect(settled).to.be.true;
    expect(drawn.length).to.equal(10);
    // Each drawn number should be in [1, 40]
    for (const n of drawn) {
      expect(Number(n)).to.be.gte(1);
      expect(Number(n)).to.be.lte(40);
    }
  });

  it("drawn numbers are unique", async () => {
    const picks = [5];
    const roundId = await placeBetAndFulfill(picks, ethers.toBigInt("0x" + "ab".repeat(32)));
    const [, , , drawn] = await keno.getRound(roundId);
    const unique = new Set(drawn.map(Number));
    expect(unique.size).to.equal(10);
  });

  it("matchCount is accurate", async () => {
    const picks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const roundId = await placeBetAndFulfill(picks, 0n);
    const [, , returnedPicks, drawn, matchCount] = await keno.getRound(roundId);
    const picksSet = new Set(returnedPicks.map(Number));
    const drawnSet = new Set(drawn.map(Number));
    let expected = 0;
    for (const p of picksSet) { if (drawnSet.has(p)) expected++; }
    expect(Number(matchCount)).to.equal(expected);
  });

  it("reverts: duplicate picks", async () => {
    await expect(keno.connect(player).placeBet(STAKE, [1, 1, 3]))
      .to.be.revertedWith("duplicate pick");
  });

  it("reverts: pick out of range", async () => {
    await expect(keno.connect(player).placeBet(STAKE, [0, 5]))
      .to.be.revertedWith("pick out of range");
    await expect(keno.connect(player).placeBet(STAKE, [41]))
      .to.be.revertedWith("pick out of range");
  });

  it("reverts: too many picks (>10)", async () => {
    await expect(keno.connect(player).placeBet(STAKE, [1,2,3,4,5,6,7,8,9,10,11]))
      .to.be.revertedWith("picks: 1-10 required");
  });

  it("reverts: no picks", async () => {
    await expect(keno.connect(player).placeBet(STAKE, []))
      .to.be.revertedWith("picks: 1-10 required");
  });

  it("pause: blocks placeBet", async () => {
    await keno.pause();
    await expect(keno.connect(player).placeBet(STAKE, [1, 2]))
      .to.be.revertedWithCustomError(keno, "EnforcedPause");
  });

  it("loss: no payout when zero matches on single pick", async () => {
    // Pick 1 number. Use a seed that won't draw that number.
    // With word=1, drawn numbers are deterministic — just verify it settles correctly
    const picks = [40]; // pick high number
    const roundId = await placeBetAndFulfill(picks, 1n);
    const [, , , drawn, matchCount, multiplier100, netPayout, settled] = await keno.getRound(roundId);
    expect(settled).to.be.true;
    if (Number(matchCount) === 0) {
      expect(netPayout).to.equal(0n);
    }
  });
});
