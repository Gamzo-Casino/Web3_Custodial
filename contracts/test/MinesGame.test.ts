import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ──────────────────────────────────────────────────────────────────────────────
// TypeScript helper: replicate the contract's Fisher-Yates mine derivation
// so tests can compute mine positions without calling getMinePositions() every
// time.  Algorithm mirrors MinesGame._deriveMineMap / _shuffleDeck exactly.
// ──────────────────────────────────────────────────────────────────────────────
function deriveMinePositions(vrfSeed: bigint, mineCount: number): Set<number> {
  const tiles: number[] = Array.from({ length: 25 }, (_, i) => i);

  for (let i = 24; i > 0; i--) {
    // j = keccak256(abi.encodePacked(seed, i)) % (i + 1)
    const packed = ethers.solidityPacked(["uint256", "uint8"], [vrfSeed, i]);
    const hash = ethers.keccak256(packed);
    const j = Number(BigInt(hash) % BigInt(i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }

  const mines = new Set<number>();
  for (let k = 0; k < mineCount; k++) {
    mines.add(tiles[k]);
  }
  return mines;
}

// ──────────────────────────────────────────────────────────────────────────────

describe("MinesGame", function () {
  let admin: SignerWithAddress;
  let player: SignerWithAddress;
  let gzoToken: any;
  let treasury: any;
  let coordinator: any;
  let mockVRF: any;
  let mines: any;

  const GAME_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GAME_ROLE"));
  const minStake  = ethers.parseEther("1");
  const maxStake  = ethers.parseEther("10000");
  const STAKE     = ethers.parseEther("100");
  const MINE_COUNT = 5; // safe number for tests (20 safe tiles remain)

  // deterministic seed for all VRF fulfillments
  const TEST_SEED = ethers.toBigInt("0x" + "ab".repeat(32));

  beforeEach(async () => {
    [admin, player] = await ethers.getSigners();

    // 1. Mock VRF
    const MockVRF = await ethers.getContractFactory("MockVRFCoordinator");
    mockVRF = await MockVRF.deploy();

    // 2. GZO Token
    const GZOToken = await ethers.getContractFactory("GZOToken");
    gzoToken = await upgrades.deployProxy(GZOToken, [admin.address], { kind: "uups" });

    // 3. Treasury
    const TreasuryVault = await ethers.getContractFactory("TreasuryVault");
    treasury = await upgrades.deployProxy(
      TreasuryVault,
      [await gzoToken.getAddress(), admin.address],
      { kind: "uups" }
    );

    // 4. Randomness Coordinator
    const RandomnessCoordinator = await ethers.getContractFactory("RandomnessCoordinator");
    coordinator = await upgrades.deployProxy(
      RandomnessCoordinator,
      [admin.address, await mockVRF.getAddress(), ethers.ZeroHash, 1],
      { kind: "uups" }
    );

    // 5. MinesGame
    const MinesGame = await ethers.getContractFactory("MinesGame");
    mines = await upgrades.deployProxy(
      MinesGame,
      [admin.address, await treasury.getAddress(), await coordinator.getAddress(), minStake, maxStake],
      { kind: "uups" }
    );

    const minesAddr       = await mines.getAddress();
    const coordinatorAddr = await coordinator.getAddress();
    const treasuryAddr    = await treasury.getAddress();

    // 6. Grant roles
    await treasury.grantRole(GAME_ROLE, minesAddr);
    await coordinator.grantRole(GAME_ROLE, minesAddr);

    // 7. Fund bankroll — needs to cover 5-mine worst case (53130× → 5.3M GZO per 100 GZO stake)
    const SUPPLY = ethers.parseEther("10000000");
    await gzoToken.mint(admin.address, SUPPLY);
    await gzoToken.approve(treasuryAddr, SUPPLY);
    await treasury.depositBankroll(SUPPLY);

    // 8. Mint to player and approve treasury
    await gzoToken.mint(player.address, ethers.parseEther("10000"));
    await gzoToken.connect(player).approve(treasuryAddr, ethers.parseEther("10000"));
  });

  // ── Helper: start a round and fulfil VRF, return { roundId, vrfReqId } ─────

  async function startAndFulfil(seed: bigint = TEST_SEED): Promise<{ roundId: string; vrfReqId: bigint }> {
    const tx = await mines.connect(player).startRound(STAKE, MINE_COUNT);
    const receipt = await tx.wait();

    const startEvent = receipt?.logs
      .map((l: any) => { try { return mines.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundStarted");

    const roundId  = startEvent!.args.roundId as string;
    const vrfReqId = startEvent!.args.vrfRequestId as bigint;

    await mockVRF.fulfillRandomWords(vrfReqId, await coordinator.getAddress(), seed);

    return { roundId, vrfReqId };
  }

  // ── 1. startRound: locks stake and emits RoundStarted ─────────────────────

  it("startRound: locks stake and emits RoundStarted", async () => {
    const balanceBefore = await gzoToken.balanceOf(player.address);

    const tx = await mines.connect(player).startRound(STAKE, MINE_COUNT);
    const receipt = await tx.wait();

    // Check event
    const startEvent = receipt?.logs
      .map((l: any) => { try { return mines.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundStarted");

    expect(startEvent).to.not.be.undefined;
    expect(startEvent!.args.player).to.equal(player.address);
    expect(startEvent!.args.stake).to.equal(STAKE);
    expect(startEvent!.args.mineCount).to.equal(MINE_COUNT);

    // Stake should be deducted from player wallet
    const balanceAfter = await gzoToken.balanceOf(player.address);
    expect(balanceBefore - balanceAfter).to.equal(STAKE);

    // Round stored correctly
    const roundId = startEvent!.args.roundId as string;
    const round   = await mines.getRound(roundId);
    expect(round.player).to.equal(player.address);
    expect(round.stake).to.equal(STAKE);
    expect(round.mineCount).to.equal(MINE_COUNT);
    expect(round.status).to.equal(0); // PENDING
  });

  // ── 2. fulfillRandomness: stores vrfSeed, status becomes ACTIVE ───────────

  it("fulfillRandomness: stores vrfSeed, status becomes ACTIVE, emits RoundActive", async () => {
    const tx = await mines.connect(player).startRound(STAKE, MINE_COUNT);
    const receipt = await tx.wait();

    const startEvent = receipt?.logs
      .map((l: any) => { try { return mines.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundStarted");

    const roundId  = startEvent!.args.roundId as string;
    const vrfReqId = startEvent!.args.vrfRequestId as bigint;

    const fulfillTx = await mockVRF.fulfillRandomWords(
      vrfReqId,
      await coordinator.getAddress(),
      TEST_SEED
    );
    const fulfillReceipt = await fulfillTx.wait();

    // RoundActive event emitted by MinesGame (propagated through coordinator)
    const activeEvent = fulfillReceipt?.logs
      .map((l: any) => { try { return mines.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundActive");

    expect(activeEvent).to.not.be.undefined;
    expect(activeEvent!.args.roundId).to.equal(roundId);
    expect(activeEvent!.args.vrfSeed).to.equal(TEST_SEED);

    const round = await mines.getRound(roundId);
    expect(round.status).to.equal(1);  // ACTIVE
    expect(round.vrfSeed).to.equal(TEST_SEED);
  });

  // ── 3. cashout: verifies safe tiles, pays out correctly ───────────────────

  it("cashout: verifies safe tiles, pays out correctly", async () => {
    const { roundId } = await startAndFulfil();

    // Get mine positions from contract (uses same algorithm)
    const minePositions: bigint[] = await mines.getMinePositions(roundId);
    const mineSet = new Set(minePositions.map((p: bigint) => Number(p)));

    // Pick 3 safe tiles
    const safeTiles: number[] = [];
    for (let i = 0; i < 25 && safeTiles.length < 3; i++) {
      if (!mineSet.has(i)) safeTiles.push(i);
    }
    expect(safeTiles).to.have.lengthOf(3);

    const balanceBefore = await gzoToken.balanceOf(player.address);

    const cashoutTx = await mines.connect(player).cashout(roundId, safeTiles);
    const cashoutReceipt = await cashoutTx.wait();

    const cashoutEvent = cashoutReceipt?.logs
      .map((l: any) => { try { return mines.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundCashedOut");

    expect(cashoutEvent).to.not.be.undefined;
    expect(cashoutEvent!.args.player).to.equal(player.address);
    expect(cashoutEvent!.args.safePicks).to.equal(3n);

    // multiplier100 should be > 100 (> 1× with 3 safe picks and 5 mines)
    expect(cashoutEvent!.args.multiplier100).to.be.gt(100n);

    // Player should receive net payout
    const balanceAfter = await gzoToken.balanceOf(player.address);
    const netPayout = cashoutEvent!.args.netPayout as bigint;
    expect(netPayout).to.be.gt(0n);
    expect(balanceAfter - balanceBefore).to.equal(netPayout);

    // Round should be CASHED_OUT
    const round = await mines.getRound(roundId);
    expect(round.status).to.equal(2); // CASHED_OUT
  });

  // ── 4. cashout: reverts if tile is a mine ─────────────────────────────────

  it("cashout: reverts if tile is a mine", async () => {
    const { roundId } = await startAndFulfil();

    const minePositions: bigint[] = await mines.getMinePositions(roundId);
    const mineTile = Number(minePositions[0]);

    await expect(
      mines.connect(player).cashout(roundId, [mineTile])
    ).to.be.revertedWith("tile is a mine");
  });

  // ── 5. loseRound: verifies mine hit, absorbs stake ────────────────────────

  it("loseRound: verifies mine hit, absorbs stake", async () => {
    const { roundId } = await startAndFulfil();

    const minePositions: bigint[] = await mines.getMinePositions(roundId);
    const mineTile = Number(minePositions[0]);

    const balanceBefore = await gzoToken.balanceOf(player.address);

    const loseTx = await mines.connect(player).loseRound(roundId, mineTile);
    const loseReceipt = await loseTx.wait();

    const loseEvent = loseReceipt?.logs
      .map((l: any) => { try { return mines.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundLost");

    expect(loseEvent).to.not.be.undefined;
    expect(loseEvent!.args.player).to.equal(player.address);
    expect(loseEvent!.args.hitTile).to.equal(mineTile);

    // Player receives nothing (stake absorbed)
    const balanceAfter = await gzoToken.balanceOf(player.address);
    expect(balanceAfter).to.equal(balanceBefore);

    const round = await mines.getRound(roundId);
    expect(round.status).to.equal(3); // LOST
  });

  // ── 6. loseRound: reverts if tile is not a mine ───────────────────────────

  it("loseRound: reverts if tile is not a mine", async () => {
    const { roundId } = await startAndFulfil();

    const minePositions: bigint[] = await mines.getMinePositions(roundId);
    const mineSet = new Set(minePositions.map((p: bigint) => Number(p)));

    // Find the first safe tile
    let safeTile = -1;
    for (let i = 0; i < 25; i++) {
      if (!mineSet.has(i)) { safeTile = i; break; }
    }
    expect(safeTile).to.be.gte(0);

    await expect(
      mines.connect(player).loseRound(roundId, safeTile)
    ).to.be.revertedWith("not a mine");
  });

  // ── 7. refundPending: admin can refund after 1 hour ───────────────────────

  it("refundPending: admin can refund after 1 hour", async () => {
    // Start a round but do NOT fulfil VRF — it stays PENDING
    const tx = await mines.connect(player).startRound(STAKE, MINE_COUNT);
    const receipt = await tx.wait();

    const startEvent = receipt?.logs
      .map((l: any) => { try { return mines.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundStarted");

    const roundId = startEvent!.args.roundId as string;

    // Should revert before 1 hour has passed
    await expect(
      mines.connect(admin).refundPending(roundId)
    ).to.be.revertedWith("too early to refund");

    // Advance time by more than 1 hour
    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);

    const balanceBefore = await gzoToken.balanceOf(player.address);
    const refundTx = await mines.connect(admin).refundPending(roundId);
    const refundReceipt = await refundTx.wait();

    const refundEvent = refundReceipt?.logs
      .map((l: any) => { try { return mines.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundRefunded");

    expect(refundEvent).to.not.be.undefined;
    expect(refundEvent!.args.roundId).to.equal(roundId);
    expect(refundEvent!.args.player).to.equal(player.address);

    // Stake returned
    const balanceAfter = await gzoToken.balanceOf(player.address);
    expect(balanceAfter - balanceBefore).to.equal(STAKE);

    const round = await mines.getRound(roundId);
    expect(round.status).to.equal(4); // REFUNDED
  });

  // ── 8. pause: reverts startRound when paused ──────────────────────────────

  it("pause: reverts startRound when paused", async () => {
    await mines.connect(admin).pause();

    await expect(
      mines.connect(player).startRound(STAKE, MINE_COUNT)
    ).to.be.revertedWithCustomError(mines, "EnforcedPause");

    // Unpause and confirm it works again
    await mines.connect(admin).unpause();
    const tx = await mines.connect(player).startRound(STAKE, MINE_COUNT);
    const receipt = await tx.wait();
    const startEvent = receipt?.logs
      .map((l: any) => { try { return mines.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundStarted");
    expect(startEvent).to.not.be.undefined;
  });

  // ── Extra: stake out of range reverts ────────────────────────────────────

  it("rejects stake out of range", async () => {
    await expect(
      mines.connect(player).startRound(0, MINE_COUNT)
    ).to.be.revertedWith("stake out of range");

    await expect(
      mines.connect(player).startRound(ethers.parseEther("100000"), MINE_COUNT)
    ).to.be.revertedWith("stake out of range");
  });

  // ── Extra: invalid mine count reverts ────────────────────────────────────

  it("rejects invalid mine count", async () => {
    await expect(
      mines.connect(player).startRound(STAKE, 0)
    ).to.be.revertedWith("invalid mine count");

    await expect(
      mines.connect(player).startRound(STAKE, 25)
    ).to.be.revertedWith("invalid mine count");
  });
});
