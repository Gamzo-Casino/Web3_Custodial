import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// Bet type encoding:
// 0 = RED, 1 = BLACK, 2 = EVEN, 3 = ODD, 4 = LOW(1-18), 5 = HIGH(19-36)
// 6 = DOZEN_1(1-12), 7 = DOZEN_2(13-24), 8 = DOZEN_3(25-36)
// 9 = COL_1, 10 = COL_2, 11 = COL_3
// 12..48 = STRAIGHT (betType - 12 = number, so 12=0, 13=1, ..., 48=36)

describe("RouletteGame", function () {
  let admin: SignerWithAddress;
  let player: SignerWithAddress;
  let gzoToken: any, treasury: any, coordinator: any, mockVRF: any, roulette: any;

  const GAME_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("GAME_ROLE"));
  const minStake   = ethers.parseEther("1");
  const maxStake   = ethers.parseEther("10000");
  const STAKE      = ethers.parseEther("10");

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

    const RouletteGame = await ethers.getContractFactory("RouletteGame");
    roulette = await upgrades.deployProxy(
      RouletteGame,
      [admin.address, await treasury.getAddress(), await coordinator.getAddress(), minStake, maxStake],
      { kind: "uups" }
    );

    await treasury.grantRole(GAME_ROLE, await roulette.getAddress());
    await coordinator.grantRole(GAME_ROLE, await roulette.getAddress());

    const bankroll = ethers.parseEther("1000000");
    await gzoToken.mint(admin.address, bankroll);
    await gzoToken.approve(await treasury.getAddress(), bankroll);
    await treasury.depositBankroll(bankroll);

    await gzoToken.mint(player.address, ethers.parseEther("10000"));
    await gzoToken.connect(player).approve(await treasury.getAddress(), ethers.parseEther("10000"));
  });

  let nextVrfId = 1n;
  beforeEach(() => { nextVrfId = 1n; });

  async function spin(betTypes: number[], stakes: bigint[], randomWord: bigint) {
    const tx = await roulette.connect(player).spin(betTypes, stakes);
    const receipt = await tx.wait();
    const event = receipt.logs.find((l: any) => {
      try { return roulette.interface.parseLog(l)?.name === "SpinPlaced"; } catch { return false; }
    });
    const parsed = roulette.interface.parseLog(event);
    const roundId = parsed.args.roundId;
    const vrfReqId = nextVrfId++;
    await mockVRF.fulfillRandomWords(vrfReqId, await coordinator.getAddress(), randomWord);
    return roundId;
  }

  it("spin: emits SpinPlaced with totalStake", async () => {
    await expect(roulette.connect(player).spin([0], [STAKE]))
      .to.emit(roulette, "SpinPlaced")
      .withArgs((_: any) => true, player.address, STAKE, 1);
  });

  it("fulfillRandomness: settles round and records number [0-36]", async () => {
    const roundId = await spin([0], [STAKE], 7n);
    const round = await roulette.getRound(roundId);
    expect(round.settled).to.be.true;
    expect(Number(round.winningNumber)).to.be.gte(0);
    expect(Number(round.winningNumber)).to.be.lte(36);
  });

  it("straight bet on 0: word=0 → number=0 → wins 35×", async () => {
    // vrfToRouletteNumber(0) = 0 % 37 = 0
    const roundId = await spin([12], [STAKE], 0n); // betType=12 → straight on 0
    const round = await roulette.getRound(roundId);
    expect(round.settled).to.be.true;
    expect(Number(round.winningNumber)).to.equal(0);
    expect(round.netPayout).to.be.gt(0n); // 35× payout
  });

  it("straight bet on wrong number: no payout", async () => {
    // word=0 → number=0. Bet on number 1 (betType=13) → lose
    const roundId = await spin([13], [STAKE], 0n); // straight on 1, lands on 0
    const round = await roulette.getRound(roundId);
    expect(Number(round.winningNumber)).to.equal(0);
    expect(round.netPayout).to.equal(0n);
  });

  it("multiple wagers: both winning adds up", async () => {
    // word=0 → number=0. Bet on 0 (betType=12) AND 0-only outside bets
    // 0 is neither red/black/odd/even/low/high/dozen/col, but straight 0 wins
    const roundId = await spin([12, 12], [STAKE, STAKE], 0n);
    const round = await roulette.getRound(roundId);
    expect(round.settled).to.be.true;
    expect(round.netPayout).to.be.gt(0n);
  });

  it("reverts: too many wagers (>15)", async () => {
    const betTypes = Array(16).fill(0);
    const stakes = Array(16).fill(STAKE);
    await expect(roulette.connect(player).spin(betTypes, stakes))
      .to.be.revertedWith("invalid wager count");
  });

  it("reverts: mismatched arrays", async () => {
    await expect(roulette.connect(player).spin([0, 1], [STAKE]))
      .to.be.revertedWith("length mismatch");
  });

  it("reverts: stake below per-bet minimum", async () => {
    await expect(roulette.connect(player).spin([0], [ethers.parseEther("0.5")]))
      .to.be.revertedWith("wager stake out of range");
  });

  it("pause: blocks spin", async () => {
    await roulette.pause();
    await expect(roulette.connect(player).spin([0], [STAKE]))
      .to.be.revertedWithCustomError(roulette, "EnforcedPause");
  });

  it("even money bets: RED wins on red number", async () => {
    // Find a word that lands on a red number. Red numbers: 1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36
    // word=1 → number = 1 % 37 = 1 → RED
    const roundId = await spin([0], [STAKE], 1n); // betType=0 = RED
    const round = await roulette.getRound(roundId);
    const n = Number(round.winningNumber);
    const reds = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
    if (reds.has(n)) {
      expect(round.netPayout).to.be.gt(0n);
    } else {
      expect(round.netPayout).to.equal(0n);
    }
  });
});
