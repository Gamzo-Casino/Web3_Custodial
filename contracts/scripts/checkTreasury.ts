import { ethers } from "hardhat";

const TREASURY_VAULT    = "0xE74c5A5d10F5CcE18282Cd306AF207e0Fd310aAd";
const PUBLIC_TREASURY   = "0xF2050102401849d615e1855A9FAd4327CDeeF2cF";
const HOUSE_WALLET      = "0x3188f8a7627279E7D287CEEfb0080c6E350Fe528";
const GZO_TOKEN         = "0x43446C2FE00E94CF4aee508A64D301e90776F23E";

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

const TREASURY_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function paused() view returns (bool)",
  "function totalLocked() view returns (uint256)",
  "function owner() view returns (address)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const provider = ethers.provider;
  const gzo = new ethers.Contract(GZO_TOKEN, ERC20_ABI, signer);

  const addresses = {
    "TreasuryVault (game escrow)": TREASURY_VAULT,
    "Public funds wallet":         PUBLIC_TREASURY,
    "House Wallet":                HOUSE_WALLET,
  };

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Treasury Analysis — Polygon Amoy");
  console.log("══════════════════════════════════════════════════════\n");

  for (const [label, addr] of Object.entries(addresses)) {
    const maticBal = await provider.getBalance(addr);
    const gzoBal   = await gzo.balanceOf(addr);
    const code      = await provider.getCode(addr);
    const isContract = code !== "0x";

    console.log(`── ${label} ──`);
    console.log(`   Address    : ${addr}`);
    console.log(`   Type       : ${isContract ? "Smart Contract" : "EOA (wallet)"}`);
    console.log(`   MATIC      : ${ethers.formatEther(maticBal)} MATIC`);
    console.log(`   GZO        : ${ethers.formatEther(gzoBal)} GZO`);

    if (isContract) {
      console.log(`   Gas payer  : The CALLER pays gas (whoever sends txs to this contract)`);
      // Try to get role info
      try {
        const tv = new ethers.Contract(addr, TREASURY_ABI, signer);
        const paused = await tv.paused();
        console.log(`   Paused     : ${paused}`);
        const GAME_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GAME_ROLE"));
        const houseHasGame = await tv.hasRole(GAME_ROLE, HOUSE_WALLET);
        console.log(`   HouseWallet has GAME_ROLE: ${houseHasGame}`);
      } catch {}
    } else {
      console.log(`   Gas payer  : This wallet pays its own gas`);
    }
    console.log();
  }

  // Check who calls TreasuryVault — look at recent txs by fetching logs
  console.log("── Who calls TreasuryVault? ────────────────────────────");
  console.log("  TreasuryVault functions and their callers:");
  console.log("  • lockStake(gameId, roundId, player, amount)");
  console.log("    → Called by DiceGame/KenoGame/etc in placeBet() (non-custodial only)");
  console.log("    → Gas paid by: the PLAYER (non-custodial) or HOUSE WALLET (if via custodial)");
  console.log();
  console.log("  • payout(gameId, roundId, player, netPayout, fee)");
  console.log("    → Called by DiceGame/KenoGame/etc in fulfillRandomness()");
  console.log("    → Gas paid by: Chainlink VRF coordinator (non-custodial)");
  console.log("    → In custodial mode: payout() is NOT called (DB-side only)");
  console.log();
  console.log("  • refundLoss(gameId, roundId, player, stake)");
  console.log("    → Same as above");
  console.log();
  console.log("── Public funds wallet role ────────────────────────────");
  console.log("  This appears to be a separate EOA used for funding/topping up.");
  console.log("  It pays its own gas for any txs it sends.");
  console.log("══════════════════════════════════════════════════════\n");
}
main().catch(console.error);
