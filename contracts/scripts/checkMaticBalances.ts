import { ethers } from "hardhat";

const ADDRESSES = {
  "House Wallet (tx sender)":     "0x3188f8a7627279E7D287CEEfb0080c6E350Fe528",
  "RandomnessCoordinator (proxy)":"0x5A8b5C504743b7cd4A26adED19B77bA5B0421B67",
  "TreasuryVault":                "0xE74c5A5d10F5CcE18282Cd306AF207e0Fd310aAd",
  "DiceGame":                     "0x4b87dF81A498ed204590f9aF25b8889cd0cBC5f7",
  "PlinkoGame":                   "0x8e10fE2d7E642d21eAd14ff52F2ADD38e00c23de",
  "KenoGame":                     "0x44dC17d94345B4970caCecF7954AB676A25c6125",
  "RouletteGame":                 "0x13CeBf51251547A048DF83A5561a0361822e298b",
  "MinesGame":                    "0x55d8093C2e75E682f6183EC78e4D35641010046f",
  "BlackjackGame":                "0x370Af2cB87AFC8BDA70Daba1198c16e40C62CBC3",
  "HiloGame":                     "0x8572650a140f27F481aFA0359877cEE99d08d241",
  "CoinFlipGame":                 "0xea006b75A3564e66777dCC435954177dd860DD9c",
  "LimboGame":                    "0xeebbCe5A5Cf8a8b37988DCE3a7cA6F39Eefc62F7",
  "CrashGame":                    "0x4d1b3C9Df431Bbad6A3981F7f68f6C61C1597ad3",
  "WheelGame":                    "0x98c304b90f14c69275014eb22Eb60694d07184a2",
  "GZO Token":                    "0x43446C2FE00E94CF4aee508A64D301e90776F23E",
  "GameRegistry":                 "0x068e1830F7Faed4d4E31FdfF5e1979a24e3003d4",
};

// VRF Coordinator — check subscription LINK + native balance
const VRF_COORD  = "0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf2";
const SUB_ID     = "37121473965311191308103942488437766006292923759699378585569059143270839490077";
const VRF_ABI    = ["function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] consumers)"];
const LINK_TOKEN = "0x0Fd9e8d3aF1aaee056EB9e802c3A762a667b1904"; // Amoy LINK
const ERC20_ABI  = ["function balanceOf(address) view returns (uint256)"];

async function main() {
  const [signer] = await ethers.getSigners();
  const provider = ethers.provider;

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  MATIC Balances — Polygon Amoy");
  console.log("══════════════════════════════════════════════════════\n");

  const WARNING_THRESHOLD = ethers.parseEther("1");   // warn < 1 MATIC
  const CRITICAL_THRESHOLD = ethers.parseEther("0.1"); // critical < 0.1 MATIC

  for (const [name, addr] of Object.entries(ADDRESSES)) {
    const bal = await provider.getBalance(addr);
    const fmt = ethers.formatEther(bal);
    let flag = "";
    if (bal < CRITICAL_THRESHOLD) flag = "  ⚠️  CRITICAL — needs MATIC!";
    else if (bal < WARNING_THRESHOLD) flag = "  ⚡ LOW";
    console.log(`  ${name.padEnd(36)} ${fmt.padStart(14)} MATIC${flag}`);
  }

  console.log("\n── Chainlink VRF Subscription ─────────────────────────");
  try {
    const coord = new ethers.Contract(VRF_COORD, VRF_ABI, signer);
    const sub   = await coord.getSubscription(BigInt(SUB_ID));
    console.log(`  LINK balance (for VRF payment):  ${ethers.formatEther(sub.balance)} LINK`);
    console.log(`  Native balance (optional):        ${ethers.formatEther(sub.nativeBalance)} MATIC`);
    console.log(`  Total fulfilled requests:         ${sub.reqCount.toString()}`);
    if (sub.balance < ethers.parseEther("5")) {
      console.log("  ⚠️  LINK balance < 5 — top up soon!");
    }
  } catch (e: any) {
    console.log("  Could not read subscription:", e.message?.slice(0,100));
  }

  console.log("\n── House Wallet GZO Balance ────────────────────────────");
  try {
    const gzo = new ethers.Contract("0x43446C2FE00E94CF4aee508A64D301e90776F23E", ERC20_ABI, signer);
    const bal = await gzo.balanceOf("0x3188f8a7627279E7D287CEEfb0080c6E350Fe528");
    console.log(`  House Wallet GZO:  ${ethers.formatEther(bal)} GZO`);
  } catch {}

  console.log("\n── Who pays gas for what ───────────────────────────────");
  console.log("  House Wallet pays gas for ALL on-chain txs:");
  console.log("    • placeBetFor / dropBallFor / spinFor / startRoundFor  (game placement)");
  console.log("    • cashoutFor / loseRoundFor / settleRound              (game settlement)");
  console.log("    • manualFulfill                                         (VRF fallback)");
  console.log("    • GZO token transfers                                   (withdrawals)");
  console.log("    • setCallbackGas / upgradeProxy                         (admin ops)");
  console.log("\n  Game contracts do NOT need MATIC (no outbound calls).");
  console.log("  VRF fulfillment gas is paid by Chainlink from the LINK subscription.");
  console.log("══════════════════════════════════════════════════════\n");
}
main().catch(console.error);
