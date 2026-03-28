import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("GZOToken", () => {
  let admin: SignerWithAddress;
  let user: SignerWithAddress;
  let gzo: any;

  beforeEach(async () => {
    [admin, user] = await ethers.getSigners();
    const GZOToken = await ethers.getContractFactory("GZOToken");
    gzo = await upgrades.deployProxy(GZOToken, [admin.address], { kind: "uups" });
  });

  it("has correct name and symbol", async () => {
    expect(await gzo.name()).to.equal("Gamezo");
    expect(await gzo.symbol()).to.equal("GZO");
  });

  it("admin can mint", async () => {
    await gzo.mint(user.address, ethers.parseEther("1000"));
    expect(await gzo.balanceOf(user.address)).to.equal(ethers.parseEther("1000"));
  });

  it("faucet mints 10000 GZO to caller", async () => {
    await gzo.connect(user).faucet();
    expect(await gzo.balanceOf(user.address)).to.equal(ethers.parseEther("10000"));
  });

  it("non-minter cannot mint", async () => {
    await expect(gzo.connect(user).mint(user.address, 1)).to.be.reverted;
  });

  it("is upgradeable", async () => {
    const GZOTokenV2 = await ethers.getContractFactory("GZOToken");
    const upgraded = await upgrades.upgradeProxy(await gzo.getAddress(), GZOTokenV2, { kind: "uups" });
    expect(await upgraded.symbol()).to.equal("GZO");
  });
});
