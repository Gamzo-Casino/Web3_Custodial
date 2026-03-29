/**
 * Manually fulfill all stuck VRF requests.
 * Run: npx hardhat run scripts/fulfillAllPending.ts --network amoy
 */
import { ethers } from "hardhat";

const RC_PROXY = "0x5A8b5C504743b7cd4A26adED19B77bA5B0421B67";

const RC_ABI = [
  "function manualFulfill(uint256 vrfRequestId, uint256 randomWord) external",
  "function requests(uint256 vrfRequestId) view returns (bytes32 gameId, address gameContract, bytes32 roundId, bool fulfilled)",
];

// All 7 pending bets — VRF IDs from GET /api/admin/fulfill-vrf
const PENDING = [
  { betId: "cmnbf13px", game: "KENO",    vrfId: "31590577902644851194319342038958782869395587716061724137758041145096794586751" },
  { betId: "cmnbf4oh5", game: "ROULETTE",vrfId: "71630934168914440726493905874532347543917717621329128774422533591324582516454" },
  { betId: "cmnbigh2l", game: "DICE",    vrfId: "68409350705903186662431108851816340166963008284424938257836705117404322544452" }, // already done
  { betId: "cmnbjaxit", game: "DICE",    vrfId: "30661466684412322160030073072739614600002289312624681939800689345649828817811" },
  { betId: "cmnbjc54r", game: "DICE",    vrfId: "86287612381178102044732008726234097671594133270922564528088092541650953994520" },
  { betId: "cmnbjcqle", game: "PLINKO",  vrfId: "88608971769046001357309168846455986419349325603661751871900180541071855400385" },
  { betId: "cmnbjfcjh", game: "DICE",    vrfId: "74593406203350938414566309317560769752341780891159730976703987335173885923855" },
];

async function main() {
  const [signer] = await ethers.getSigners();
  const rc = new ethers.Contract(RC_PROXY, RC_ABI, signer);
  
  console.log("══════════════════════════════════════");
  console.log("  Manual VRF Fulfillment");
  console.log("  Signer:", signer.address);
  console.log("══════════════════════════════════════\n");

  for (const p of PENDING) {
    const req = await rc.requests(BigInt(p.vrfId));
    if (req.fulfilled) {
      console.log(`[${p.game}] ${p.betId} — already fulfilled, skipping`);
      continue;
    }

    const randomWord = BigInt(ethers.hexlify(ethers.randomBytes(32)));
    try {
      console.log(`[${p.game}] ${p.betId} — fulfilling...`);
      const tx = await rc.manualFulfill(BigInt(p.vrfId), randomWord, { gasLimit: 500_000 });
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        console.log(`  ✓ tx: ${tx.hash}`);
      } else {
        console.log(`  ✗ REVERTED tx: ${tx.hash}`);
      }
    } catch (err: any) {
      console.log(`  ✗ ERROR: ${err.message?.slice(0, 200)}`);
    }
  }
  console.log("\n══════════════════════════════════════");
  console.log("Done. Poll /api/games/<game>/status for each bet to credit DB.");
  console.log("══════════════════════════════════════");
}
main().catch(console.error);
