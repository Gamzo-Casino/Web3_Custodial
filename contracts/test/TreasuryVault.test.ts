import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("TreasuryVault", () => {
  let admin: SignerWithAddress;
  let game: SignerWithAddress;
  let player: SignerWithAddress;
  let gzo: any;
  let vault: any;
  const GAME_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GAME_ROLE"));
  const GAME_ID   = ethers.keccak256(ethers.toUtf8Bytes("TEST_GAME"));
  const ROUND_ID  = ethers.keccak256(ethers.toUtf8Bytes("round1"));

  beforeEach(async () => {
    [admin, game, player] = await ethers.getSigners();

    const GZOToken = await ethers.getContractFactory("GZOToken");
    gzo = await upgrades.deployProxy(GZOToken, [admin.address], { kind: "uups" });

    const TreasuryVault = await ethers.getContractFactory("TreasuryVault");
    vault = await upgrades.deployProxy(TreasuryVault, [await gzo.getAddress(), admin.address], { kind: "uups" });

    const vaultAddr = await vault.getAddress();

    // Grant GAME_ROLE to mock game signer
    await vault.grantRole(GAME_ROLE, game.address);

    // Mint GZO
    await gzo.mint(admin.address, ethers.parseEther("1000000"));
    await gzo.mint(player.address, ethers.parseEther("10000"));

    // Fund vault bankroll
    await gzo.approve(vaultAddr, ethers.parseEther("1000000"));
    await vault.depositBankroll(ethers.parseEther("1000000"));

    // Player approves vault
    await gzo.connect(player).approve(vaultAddr, ethers.parseEther("10000"));
  });

  it("accepts stake from player", async () => {
    const stake = ethers.parseEther("100");
    await vault.connect(game).lockStake(GAME_ID, ROUND_ID, player.address, stake);
    expect(await vault.lockedByGame(GAME_ID)).to.equal(stake);
  });

  it("pays winner correctly", async () => {
    const stake = ethers.parseEther("100");
    // Lock two stakes to simulate a 2-player pot (200 GZO total)
    await vault.connect(game).lockStake(GAME_ID, ROUND_ID, player.address, stake);
    await vault.connect(game).lockStake(GAME_ID, ethers.keccak256(ethers.toUtf8Bytes("round2")), player.address, stake);

    // Capture balance AFTER both lockStakes (player has spent 200 GZO)
    const playerBefore = await gzo.balanceOf(player.address);
    const net = ethers.parseEther("190"); // 200 gross - 10 fee
    const fee = ethers.parseEther("10");

    await vault.connect(game).payout(GAME_ID, ROUND_ID, player.address, net, fee);
    const playerAfter = await gzo.balanceOf(player.address);
    expect(playerAfter - playerBefore).to.equal(net);
  });

  it("non-game role cannot lock stake", async () => {
    await expect(
      vault.connect(player).lockStake(GAME_ID, ROUND_ID, player.address, ethers.parseEther("1"))
    ).to.be.reverted;
  });

  it("is upgradeable", async () => {
    const TreasuryV2 = await ethers.getContractFactory("TreasuryVault");
    const upgraded = await upgrades.upgradeProxy(await vault.getAddress(), TreasuryV2, { kind: "uups" });
    expect(await upgraded.gzoToken()).to.equal(await gzo.getAddress());
  });
});
