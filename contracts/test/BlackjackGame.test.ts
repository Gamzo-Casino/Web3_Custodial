import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ──────────────────────────────────────────────────────────────────────────────
// TypeScript helpers: mirror the contract's deck shuffle and hand-value logic
// so tests can derive the real deck and produce valid card/position arrays.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Fisher-Yates shuffle of 52 cards using keccak256(seed, i) — mirrors
 * BlackjackGame._shuffleDeck exactly.
 */
function shuffleDeck(seed: bigint): number[] {
  const deck: number[] = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const packed = ethers.solidityPacked(["uint256", "uint8"], [seed, i]);
    const hash = ethers.keccak256(packed);
    const j = Number(BigInt(hash) % BigInt(i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Blackjack hand value — mirrors GameMath.blackjackHandValue.
 * Rank 0 = Ace (11 or 1), Ranks 1-9 = 2-10, Rank 10-12 = 10.
 */
function handValue(cards: number[]): { val: number; soft: boolean } {
  let val = 0;
  let aces = 0;
  for (const card of cards) {
    const rank = card % 13;
    if (rank === 0) {
      aces++;
      val += 11;
    } else if (rank >= 10) {
      val += 10;
    } else {
      val += rank + 1;
    }
  }
  while (val > 21 && aces > 0) {
    val -= 10;
    aces--;
  }
  return { val, soft: aces > 0 && val <= 21 };
}

/**
 * Find a scenario from the deck where the player (positions 0, 2) beats
 * the dealer (positions 1, 3) with a normal win (no blackjack, no bust).
 * Returns { playerCards, dealerCards, playerPositions, dealerPositions }
 * or null if the shuffled deck doesn't yield a clean win scenario.
 */
function findPlayerWinScenario(deck: number[]): {
  playerCards: number[];
  dealerCards: number[];
  playerPositions: number[];
  dealerPositions: number[];
} | null {
  // European deal: p[0], d[0], p[1], d[1] (positions 0,1,2,3)
  const pCards = [deck[0], deck[2]];
  const dCards = [deck[1], deck[3]];
  const pVal   = handValue(pCards).val;
  const dVal   = handValue(dCards).val;

  // Need a clear non-blackjack player win
  const pBJ = pCards.length === 2 && pVal === 21;
  const dBJ = dCards.length === 2 && dVal === 21;

  if (!pBJ && !dBJ && pVal > dVal && pVal <= 21) {
    return {
      playerCards:     pCards,
      dealerCards:     dCards,
      playerPositions: [0, 2],
      dealerPositions: [1, 3],
    };
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────

describe("BlackjackGame", function () {
  let admin: SignerWithAddress;
  let player: SignerWithAddress;
  let gzoToken: any;
  let treasury: any;
  let coordinator: any;
  let mockVRF: any;
  let blackjack: any;

  const GAME_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GAME_ROLE"));
  const minStake  = ethers.parseEther("1");
  const maxStake  = ethers.parseEther("10000");
  const STAKE     = ethers.parseEther("100");

  // We will iterate over seeds to find one where player wins the opening 4 cards.
  // Seeds are deterministic so this never flakes.
  let TEST_SEED: bigint;
  let winDeck: number[];

  before(async () => {
    // Find a seed that gives a clean player-win scenario with the first 4 cards.
    // Try seeds 1, 2, 3, … until we find one.
    for (let s = 1n; s <= 10000n; s++) {
      const deck = shuffleDeck(s);
      const scenario = findPlayerWinScenario(deck);
      if (scenario !== null) {
        TEST_SEED = s;
        winDeck   = deck;
        break;
      }
    }
    if (!TEST_SEED) throw new Error("Could not find a player-win seed in first 10000 tries");
  });

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

    // 5. BlackjackGame
    const BlackjackGame = await ethers.getContractFactory("BlackjackGame");
    blackjack = await upgrades.deployProxy(
      BlackjackGame,
      [admin.address, await treasury.getAddress(), await coordinator.getAddress(), minStake, maxStake],
      { kind: "uups" }
    );

    const bjAddr          = await blackjack.getAddress();
    const coordinatorAddr = await coordinator.getAddress();
    const treasuryAddr    = await treasury.getAddress();

    // 6. Grant roles
    await treasury.grantRole(GAME_ROLE, bjAddr);
    await coordinator.grantRole(GAME_ROLE, bjAddr);

    // 7. Fund bankroll
    const SUPPLY = ethers.parseEther("1000000");
    await gzoToken.mint(admin.address, SUPPLY);
    await gzoToken.approve(treasuryAddr, SUPPLY);
    await treasury.depositBankroll(SUPPLY);

    // 8. Mint to player and approve
    await gzoToken.mint(player.address, ethers.parseEther("10000"));
    await gzoToken.connect(player).approve(treasuryAddr, ethers.parseEther("10000"));
  });

  // ── Helper: start a round + fulfil VRF with seed ─────────────────────────

  async function startAndFulfil(seed: bigint): Promise<{ roundId: string; vrfReqId: bigint }> {
    const tx = await blackjack.connect(player).startRound(STAKE);
    const receipt = await tx.wait();

    const startEvent = receipt?.logs
      .map((l: any) => { try { return blackjack.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundStarted");

    const roundId  = startEvent!.args.roundId as string;
    const vrfReqId = startEvent!.args.vrfRequestId as bigint;

    await mockVRF.fulfillRandomWords(vrfReqId, await coordinator.getAddress(), seed);

    return { roundId, vrfReqId };
  }

  // ── 1. startRound: locks stake and emits RoundStarted ─────────────────────

  it("startRound: locks stake and emits RoundStarted", async () => {
    const balanceBefore = await gzoToken.balanceOf(player.address);

    const tx = await blackjack.connect(player).startRound(STAKE);
    const receipt = await tx.wait();

    const startEvent = receipt?.logs
      .map((l: any) => { try { return blackjack.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundStarted");

    expect(startEvent).to.not.be.undefined;
    expect(startEvent!.args.player).to.equal(player.address);
    expect(startEvent!.args.stake).to.equal(STAKE);

    // Stake deducted
    const balanceAfter = await gzoToken.balanceOf(player.address);
    expect(balanceBefore - balanceAfter).to.equal(STAKE);

    const roundId = startEvent!.args.roundId as string;
    const round   = await blackjack.getRound(roundId);
    expect(round.player).to.equal(player.address);
    expect(round.stake).to.equal(STAKE);
    expect(round.status).to.equal(0); // PENDING
  });

  // ── 2. fulfillRandomness: stores deckSeed, status becomes ACTIVE ──────────

  it("fulfillRandomness: stores deckSeed, status becomes ACTIVE", async () => {
    const tx = await blackjack.connect(player).startRound(STAKE);
    const receipt = await tx.wait();

    const startEvent = receipt?.logs
      .map((l: any) => { try { return blackjack.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundStarted");

    const roundId  = startEvent!.args.roundId as string;
    const vrfReqId = startEvent!.args.vrfRequestId as bigint;

    const fulfillTx = await mockVRF.fulfillRandomWords(
      vrfReqId,
      await coordinator.getAddress(),
      TEST_SEED
    );
    const fulfillReceipt = await fulfillTx.wait();

    // RoundActive event
    const activeEvent = fulfillReceipt?.logs
      .map((l: any) => { try { return blackjack.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundActive");

    expect(activeEvent).to.not.be.undefined;
    expect(activeEvent!.args.deckSeed).to.equal(TEST_SEED);

    const round = await blackjack.getRound(roundId);
    expect(round.status).to.equal(1); // ACTIVE
    expect(round.deckSeed).to.equal(TEST_SEED);
  });

  // ── 3. settleRound: player wins with higher value ─────────────────────────

  it("settleRound: player wins with higher value", async () => {
    const { roundId } = await startAndFulfil(TEST_SEED);

    // Derive the actual deck from the seed
    const deck = shuffleDeck(TEST_SEED);
    const scenario = findPlayerWinScenario(deck)!;
    expect(scenario).to.not.be.null;

    const balanceBefore = await gzoToken.balanceOf(player.address);

    const settleTx = await blackjack.connect(player).settleRound(
      roundId,
      scenario.playerCards,
      scenario.dealerCards,
      scenario.playerPositions,
      scenario.dealerPositions,
      [], // no split
      [], // no split positions
      false  // no double
    );
    const settleReceipt = await settleTx.wait();

    const settleEvent = settleReceipt?.logs
      .map((l: any) => { try { return blackjack.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundSettled");

    expect(settleEvent).to.not.be.undefined;
    expect(settleEvent!.args.player).to.equal(player.address);

    const netPayout = settleEvent!.args.netPayout as bigint;
    expect(netPayout).to.be.gt(0n);

    // Player wins: gross = 2 × stake; fee = 10% of profit (= 10% of stake)
    // net = 2*stake - stake*0.1 = 1.9*stake
    const expectedNet = (STAKE * 2n) - (STAKE / 10n);
    expect(netPayout).to.be.closeTo(expectedNet, ethers.parseEther("1"));

    const balanceAfter = await gzoToken.balanceOf(player.address);
    expect(balanceAfter - balanceBefore).to.equal(netPayout);

    const round = await blackjack.getRound(roundId);
    expect(round.status).to.equal(2); // SETTLED
  });

  // ── 4. settleRound: reverts with card mismatch if wrong card claimed ──────

  it("settleRound: reverts with card mismatch if wrong card claimed", async () => {
    const { roundId } = await startAndFulfil(TEST_SEED);

    const deck = shuffleDeck(TEST_SEED);
    const scenario = findPlayerWinScenario(deck)!;

    // Swap a card for a wrong value (deck[0]+1 % 52)
    const wrongCard = (deck[0] + 1) % 52;
    const wrongPlayerCards = [wrongCard, scenario.playerCards[1]];

    await expect(
      blackjack.connect(player).settleRound(
        roundId,
        wrongPlayerCards,
        scenario.dealerCards,
        scenario.playerPositions,
        scenario.dealerPositions,
        [],
        [],
        false
      )
    ).to.be.revertedWith("card mismatch");
  });

  // ── 5. lockDouble: locks additional stake ────────────────────────────────

  it("lockDouble: locks additional stake", async () => {
    const { roundId } = await startAndFulfil(TEST_SEED);

    const balanceBefore = await gzoToken.balanceOf(player.address);
    await blackjack.connect(player).lockDouble(roundId);
    const balanceAfter = await gzoToken.balanceOf(player.address);

    // Another STAKE worth locked
    expect(balanceBefore - balanceAfter).to.equal(STAKE);

    const round = await blackjack.getRound(roundId);
    expect(round.doubleStake).to.equal(STAKE);
  });

  // ── 6. settleRound: handles push (equal values) ───────────────────────────

  it("settleRound: handles push (equal values)", async () => {
    // Find a seed where first 4 cards give equal hand values (push)
    let pushSeed: bigint | undefined;
    let pushDeck: number[] | undefined;

    for (let s = 1n; s <= 50000n; s++) {
      const deck = shuffleDeck(s);
      const pCards = [deck[0], deck[2]];
      const dCards = [deck[1], deck[3]];
      const pVal   = handValue(pCards).val;
      const dVal   = handValue(dCards).val;
      // Both non-bust, equal value, neither a natural blackjack
      const pBJ = pCards.length === 2 && pVal === 21;
      const dBJ = dCards.length === 2 && dVal === 21;
      if (!pBJ && !dBJ && pVal === dVal && pVal <= 21) {
        pushSeed = s;
        pushDeck = deck;
        break;
      }
    }

    if (!pushSeed || !pushDeck) {
      // If no push scenario found in range, skip with a note
      console.log("  [skip] No push scenario found in seed range — skipping push test");
      return;
    }

    const { roundId } = await startAndFulfil(pushSeed);

    const pCards = [pushDeck[0], pushDeck[2]];
    const dCards = [pushDeck[1], pushDeck[3]];

    const balanceBefore = await gzoToken.balanceOf(player.address);

    const settleTx = await blackjack.connect(player).settleRound(
      roundId,
      pCards,
      dCards,
      [0, 2],
      [1, 3],
      [],
      [],
      false
    );
    const settleReceipt = await settleTx.wait();

    const settleEvent = settleReceipt?.logs
      .map((l: any) => { try { return blackjack.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundSettled");

    expect(settleEvent).to.not.be.undefined;
    // On push, gross = stake (no profit), fee = 0, net = stake
    expect(settleEvent!.args.netPayout).to.equal(STAKE);

    const balanceAfter = await gzoToken.balanceOf(player.address);
    expect(balanceAfter - balanceBefore).to.equal(STAKE);
  });

  // ── 7. refundPending: admin can refund after 1 hour ───────────────────────

  it("refundPending: admin can refund after 1 hour", async () => {
    // Start round but do NOT fulfil VRF
    const tx = await blackjack.connect(player).startRound(STAKE);
    const receipt = await tx.wait();

    const startEvent = receipt?.logs
      .map((l: any) => { try { return blackjack.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundStarted");

    const roundId = startEvent!.args.roundId as string;

    // Too early
    await expect(
      blackjack.connect(admin).refundPending(roundId)
    ).to.be.revertedWith("too early");

    // Advance time
    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);

    const balanceBefore = await gzoToken.balanceOf(player.address);
    const refundTx = await blackjack.connect(admin).refundPending(roundId);
    const refundReceipt = await refundTx.wait();

    const refundEvent = refundReceipt?.logs
      .map((l: any) => { try { return blackjack.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundRefunded");

    expect(refundEvent).to.not.be.undefined;
    expect(refundEvent!.args.player).to.equal(player.address);

    const balanceAfter = await gzoToken.balanceOf(player.address);
    expect(balanceAfter - balanceBefore).to.equal(STAKE);

    const round = await blackjack.getRound(roundId);
    expect(round.status).to.equal(3); // REFUNDED
  });

  // ── Extra: stake out of range reverts ────────────────────────────────────

  it("rejects stake out of range", async () => {
    await expect(
      blackjack.connect(player).startRound(0)
    ).to.be.revertedWith("stake out of range");

    await expect(
      blackjack.connect(player).startRound(ethers.parseEther("100000"))
    ).to.be.revertedWith("stake out of range");
  });

  // ── Extra: is upgradeable ────────────────────────────────────────────────

  it("is upgradeable", async () => {
    const BlackjackV2 = await ethers.getContractFactory("BlackjackGame");
    const upgraded = await upgrades.upgradeProxy(await blackjack.getAddress(), BlackjackV2, { kind: "uups" });
    expect(await upgraded.gameName()).to.equal("Blackjack");
  });
});
