import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ──────────────────────────────────────────────────────────────────────────────
// TypeScript helpers: replicate HiloGame / GameMath deck + rank logic
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Fisher-Yates shuffle — mirrors HiloGame._shuffleDeck / BlackjackGame._shuffleDeck.
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
 * Hi-Lo rank — mirrors HiloGame._hiloRank.
 * Ace (rank 0) = 13 (high), 2 = 1, ..., King = 12.
 */
function hiloRank(card: number): number {
  const rank = card % 13; // 0=Ace, 1=2, ..., 12=King
  return rank === 0 ? 13 : rank;
}

/**
 * Evaluate a guess — mirrors HiloGame._evaluateGuess.
 * guess: 0=HIGHER, 1=LOWER, 2=SAME
 */
function evaluateGuess(currentRank: number, nextRank: number, guess: number): boolean {
  if (guess === 0) return nextRank > currentRank;
  if (guess === 1) return nextRank < currentRank;
  if (guess === 2) return nextRank === currentRank;
  return false;
}

/**
 * Find a pair of adjacent deck positions (pos, pos+1) where guessing HIGHER (0)
 * would be correct (nextRank > currentRank).
 * Returns { pos, currentCard, nextCard } or null.
 */
function findHigherPair(deck: number[]): { pos: number; currentCard: number; nextCard: number } | null {
  for (let pos = 0; pos < deck.length - 1; pos++) {
    const cur  = hiloRank(deck[pos]);
    const next = hiloRank(deck[pos + 1]);
    if (next > cur) return { pos, currentCard: deck[pos], nextCard: deck[pos + 1] };
  }
  return null;
}

/**
 * Find a pair where guessing HIGHER (0) would be WRONG (nextRank <= currentRank),
 * so guessing HIGHER at that step causes a loss.
 */
function findHigherWrongPair(deck: number[]): { pos: number; currentCard: number; nextCard: number } | null {
  for (let pos = 0; pos < deck.length - 1; pos++) {
    const cur  = hiloRank(deck[pos]);
    const next = hiloRank(deck[pos + 1]);
    if (next <= cur) return { pos, currentCard: deck[pos], nextCard: deck[pos + 1] };
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────

describe("HiloGame", function () {
  let admin: SignerWithAddress;
  let player: SignerWithAddress;
  let gzoToken: any;
  let treasury: any;
  let coordinator: any;
  let mockVRF: any;
  let hilo: any;

  const GAME_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GAME_ROLE"));
  const minStake  = ethers.parseEther("1");
  const maxStake  = ethers.parseEther("10000");
  const STAKE     = ethers.parseEther("100");

  // Deterministic seed — we will verify its deck has usable pairs in before()
  const BASE_SEED = ethers.toBigInt("0x" + "cd".repeat(32));

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

    // 5. HiloGame
    const HiloGame = await ethers.getContractFactory("HiloGame");
    hilo = await upgrades.deployProxy(
      HiloGame,
      [admin.address, await treasury.getAddress(), await coordinator.getAddress(), minStake, maxStake],
      { kind: "uups" }
    );

    const hiloAddr        = await hilo.getAddress();
    const coordinatorAddr = await coordinator.getAddress();
    const treasuryAddr    = await treasury.getAddress();

    // 6. Grant roles
    await treasury.grantRole(GAME_ROLE, hiloAddr);
    await coordinator.grantRole(GAME_ROLE, hiloAddr);

    // 7. Fund bankroll
    const SUPPLY = ethers.parseEther("1000000");
    await gzoToken.mint(admin.address, SUPPLY);
    await gzoToken.approve(treasuryAddr, SUPPLY);
    await treasury.depositBankroll(SUPPLY);

    // 8. Mint to player and approve
    await gzoToken.mint(player.address, ethers.parseEther("10000"));
    await gzoToken.connect(player).approve(treasuryAddr, ethers.parseEther("10000"));
  });

  // ── Helper: start a round + fulfil VRF ───────────────────────────────────

  async function startAndFulfil(seed: bigint): Promise<{ roundId: string; vrfReqId: bigint }> {
    const tx = await hilo.connect(player).startRound(STAKE);
    const receipt = await tx.wait();

    const startEvent = receipt?.logs
      .map((l: any) => { try { return hilo.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundStarted");

    const roundId  = startEvent!.args.roundId as string;
    const vrfReqId = startEvent!.args.vrfRequestId as bigint;

    await mockVRF.fulfillRandomWords(vrfReqId, await coordinator.getAddress(), seed);

    return { roundId, vrfReqId };
  }

  // ── 1. startRound: locks stake and emits RoundStarted ─────────────────────

  it("startRound: locks stake and emits RoundStarted", async () => {
    const balanceBefore = await gzoToken.balanceOf(player.address);

    const tx = await hilo.connect(player).startRound(STAKE);
    const receipt = await tx.wait();

    const startEvent = receipt?.logs
      .map((l: any) => { try { return hilo.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundStarted");

    expect(startEvent).to.not.be.undefined;
    expect(startEvent!.args.player).to.equal(player.address);
    expect(startEvent!.args.stake).to.equal(STAKE);

    // Stake deducted from player
    const balanceAfter = await gzoToken.balanceOf(player.address);
    expect(balanceBefore - balanceAfter).to.equal(STAKE);

    const roundId = startEvent!.args.roundId as string;
    const round   = await hilo.getRound(roundId);
    expect(round.player).to.equal(player.address);
    expect(round.stake).to.equal(STAKE);
    expect(round.status).to.equal(0); // PENDING
  });

  // ── 2. fulfillRandomness: stores deckSeed, status becomes ACTIVE ──────────

  it("fulfillRandomness: stores deckSeed, status becomes ACTIVE", async () => {
    const tx = await hilo.connect(player).startRound(STAKE);
    const receipt = await tx.wait();

    const startEvent = receipt?.logs
      .map((l: any) => { try { return hilo.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundStarted");

    const roundId  = startEvent!.args.roundId as string;
    const vrfReqId = startEvent!.args.vrfRequestId as bigint;

    const fulfillTx = await mockVRF.fulfillRandomWords(
      vrfReqId,
      await coordinator.getAddress(),
      BASE_SEED
    );
    const fulfillReceipt = await fulfillTx.wait();

    const activeEvent = fulfillReceipt?.logs
      .map((l: any) => { try { return hilo.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundActive");

    expect(activeEvent).to.not.be.undefined;
    expect(activeEvent!.args.deckSeed).to.equal(BASE_SEED);

    const round = await hilo.getRound(roundId);
    expect(round.status).to.equal(1); // ACTIVE
    expect(round.deckSeed).to.equal(BASE_SEED);
  });

  // ── 3. cashout with 0 guesses (immediate cashout = 1.00×) ────────────────
  //
  // The HiloGame.cashout signature requires cards.length >= 2.
  // An immediate cashout (no guesses applied) is encoded as:
  //   cards     = [deck[0], deck[1]]   (starting card + one more to satisfy length >= 2)
  //   positions = [0, 1]
  //   guesses   = [SAME(2)]            (1 guess for 2 cards; this guess is irrelevant —
  //                                     cashoutAt=1 stops BEFORE processing the last card)
  //   cashoutAt = 1                    (count 1 correct-guess worth then stop;
  //                                     but since SAME is very unlikely to be correct,
  //                                     the loop breaks at 0 correct — so cumMult stays 100)
  //
  // Actually the cleanest interpretation: pass cards=[c0,c1], guesses=[SAME],
  // cashoutAt=0 (all guesses).  If SAME is wrong, cumMult stays 100 and
  // cashout reverts because !correct && cashoutAt (0) <= correctGuesses (0) passes,
  // but the payout is cumMult=100 → gross=stake → no profit → fee=0 → net=stake.
  //
  // We look for a deck position pair where the SAME guess is wrong so cashout
  // immediately stops at correctGuesses=0 with cumMult=100.

  it("cashout with 0 correct guesses returns stake (cumMult 1.00×)", async () => {
    // Find a seed where deck[0]→deck[1] is NOT the same rank (SAME guess fails)
    // so that passing guesses=[2 (SAME)] with cashoutAt=0 gives cumMult=100.
    let seed: bigint = BASE_SEED;
    let foundSeed = false;
    for (let s = 1n; s <= 10000n; s++) {
      const deck = shuffleDeck(s);
      const r0 = hiloRank(deck[0]);
      const r1 = hiloRank(deck[1]);
      if (r0 !== r1) { // SAME guess would be wrong → loop breaks at 0 correct guesses
        seed = s;
        foundSeed = true;
        break;
      }
    }
    expect(foundSeed).to.be.true;

    const { roundId } = await startAndFulfil(seed);
    const deck = shuffleDeck(seed);

    const balanceBefore = await gzoToken.balanceOf(player.address);

    // cards=[deck[0], deck[1]], guesses=[SAME=2], cashoutAt=0
    // contract loop: SAME guess is wrong → cashoutAt(0) <= correctGuesses(0) → break
    // cumMult100 stays at 100 → gross = stake → net = stake (no profit, no fee)
    const cashoutTx = await hilo.connect(player).cashout(
      roundId,
      [deck[0], deck[1]],  // cards
      [0, 1],              // positions
      [2],                 // guesses: SAME (will be wrong)
      0n                   // cashoutAt = 0 (after all)
    );
    const cashoutReceipt = await cashoutTx.wait();

    const cashoutEvent = cashoutReceipt?.logs
      .map((l: any) => { try { return hilo.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundCashedOut");

    expect(cashoutEvent).to.not.be.undefined;
    expect(cashoutEvent!.args.multiplier100).to.equal(100n); // 1.00×
    expect(cashoutEvent!.args.netPayout).to.equal(STAKE);    // stake back, no fee

    const balanceAfter = await gzoToken.balanceOf(player.address);
    expect(balanceAfter - balanceBefore).to.equal(STAKE);

    const round = await hilo.getRound(roundId);
    expect(round.status).to.equal(2); // CASHED_OUT
  });

  // ── 4. cashout: correct guess accumulates multiplier ─────────────────────

  it("cashout: correct HIGHER guess accumulates multiplier above 1×", async () => {
    // Find a seed where deck[0]→deck[1] supports a correct HIGHER guess
    let seed: bigint = BASE_SEED;
    let foundSeed = false;
    for (let s = 1n; s <= 10000n; s++) {
      const deck = shuffleDeck(s);
      if (findHigherPair(deck) !== null) {
        seed = s;
        foundSeed = true;
        break;
      }
    }
    expect(foundSeed).to.be.true;

    const { roundId } = await startAndFulfil(seed);
    const deck    = shuffleDeck(seed);
    const pair    = findHigherPair(deck)!;

    // cards  = [deck[pair.pos], deck[pair.pos+1]]
    // positions = [pair.pos, pair.pos+1]
    // guesses = [0 (HIGHER)]  — correct
    // cashoutAt = 0 (count all)
    const balanceBefore = await gzoToken.balanceOf(player.address);

    const cashoutTx = await hilo.connect(player).cashout(
      roundId,
      [pair.currentCard, pair.nextCard],
      [pair.pos, pair.pos + 1],
      [0],  // HIGHER
      0n
    );
    const cashoutReceipt = await cashoutTx.wait();

    const cashoutEvent = cashoutReceipt?.logs
      .map((l: any) => { try { return hilo.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundCashedOut");

    expect(cashoutEvent).to.not.be.undefined;

    // multiplier > 100 (since one correct guess was applied)
    const mult100 = cashoutEvent!.args.multiplier100 as bigint;
    expect(mult100).to.be.gt(100n);

    // net payout > stake (profit after fee)
    const netPayout = cashoutEvent!.args.netPayout as bigint;
    expect(netPayout).to.be.gt(STAKE);

    const balanceAfter = await gzoToken.balanceOf(player.address);
    expect(balanceAfter - balanceBefore).to.equal(netPayout);
  });

  // ── 5. loseRound: wrong guess loses stake ────────────────────────────────

  it("loseRound: wrong HIGHER guess loses stake", async () => {
    // Find a seed where deck[0]→deck[1] makes HIGHER a wrong guess (nextRank <= currentRank)
    let seed: bigint = BASE_SEED;
    let foundSeed = false;
    for (let s = 1n; s <= 10000n; s++) {
      const deck = shuffleDeck(s);
      if (findHigherWrongPair(deck) !== null) {
        seed = s;
        foundSeed = true;
        break;
      }
    }
    expect(foundSeed).to.be.true;

    const { roundId } = await startAndFulfil(seed);
    const deck = shuffleDeck(seed);
    const pair = findHigherWrongPair(deck)!;

    const balanceBefore = await gzoToken.balanceOf(player.address);

    // loseRound(roundId, cards, positions, guesses, lostAtStep)
    // lostAtStep = 0: the losing guess is at index 0
    // cards must have length >= lostAtStep + 2 = 2
    const loseTx = await hilo.connect(player).loseRound(
      roundId,
      [pair.currentCard, pair.nextCard], // cards
      [pair.pos, pair.pos + 1],          // positions
      [0],                               // guesses: [HIGHER] — wrong
      0n                                 // lostAtStep
    );
    const loseReceipt = await loseTx.wait();

    const loseEvent = loseReceipt?.logs
      .map((l: any) => { try { return hilo.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundLost");

    expect(loseEvent).to.not.be.undefined;
    expect(loseEvent!.args.player).to.equal(player.address);
    expect(loseEvent!.args.stepIndex).to.equal(0n);

    // Player receives nothing (stake absorbed)
    const balanceAfter = await gzoToken.balanceOf(player.address);
    expect(balanceAfter).to.equal(balanceBefore);

    const round = await hilo.getRound(roundId);
    expect(round.status).to.equal(3); // LOST
  });

  // ── 6. refundPending: admin can refund after 1 hour ───────────────────────

  it("refundPending: admin can refund after 1 hour", async () => {
    // Start round but do NOT fulfil VRF
    const tx = await hilo.connect(player).startRound(STAKE);
    const receipt = await tx.wait();

    const startEvent = receipt?.logs
      .map((l: any) => { try { return hilo.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundStarted");

    const roundId = startEvent!.args.roundId as string;

    // Too early — should revert
    await expect(
      hilo.connect(admin).refundPending(roundId)
    ).to.be.revertedWith("too early");

    // Advance time by more than 1 hour
    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);

    const balanceBefore = await gzoToken.balanceOf(player.address);
    const refundTx = await hilo.connect(admin).refundPending(roundId);
    const refundReceipt = await refundTx.wait();

    const refundEvent = refundReceipt?.logs
      .map((l: any) => { try { return hilo.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "RoundRefunded");

    expect(refundEvent).to.not.be.undefined;
    expect(refundEvent!.args.player).to.equal(player.address);

    const balanceAfter = await gzoToken.balanceOf(player.address);
    expect(balanceAfter - balanceBefore).to.equal(STAKE);

    const round = await hilo.getRound(roundId);
    expect(round.status).to.equal(4); // REFUNDED
  });

  // ── Extra: loseRound reverts if guess was actually correct ────────────────

  it("loseRound: reverts if the guess was correct (not a loss)", async () => {
    // Find a seed where deck[0]→deck[1] gives a correct HIGHER guess
    let seed: bigint = BASE_SEED;
    for (let s = 1n; s <= 10000n; s++) {
      const deck = shuffleDeck(s);
      if (findHigherPair(deck) !== null) { seed = s; break; }
    }

    const { roundId } = await startAndFulfil(seed);
    const deck = shuffleDeck(seed);
    const pair = findHigherPair(deck)!;

    // HIGHER is correct here — loseRound should revert
    await expect(
      hilo.connect(player).loseRound(
        roundId,
        [pair.currentCard, pair.nextCard],
        [pair.pos, pair.pos + 1],
        [0],  // HIGHER — correct
        0n
      )
    ).to.be.revertedWith("guess was correct");
  });

  // ── Extra: stake out of range reverts ────────────────────────────────────

  it("rejects stake out of range", async () => {
    await expect(
      hilo.connect(player).startRound(0)
    ).to.be.revertedWith("stake out of range");

    await expect(
      hilo.connect(player).startRound(ethers.parseEther("100000"))
    ).to.be.revertedWith("stake out of range");
  });

  // ── Extra: is upgradeable ────────────────────────────────────────────────

  it("is upgradeable", async () => {
    const HiloV2 = await ethers.getContractFactory("HiloGame");
    const upgraded = await upgrades.upgradeProxy(await hilo.getAddress(), HiloV2, { kind: "uups" });
    expect(await upgraded.gameName()).to.equal("HiLo");
  });
});
