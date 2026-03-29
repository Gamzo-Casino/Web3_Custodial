import { ethers } from "hardhat";

const RC_PROXY = "0x5A8b5C504743b7cd4A26adED19B77bA5B0421B67";
const RC_ABI = [
  "function requests(uint256 vrfRequestId) view returns (bytes32 gameId, address gameContract, bytes32 roundId, bool fulfilled)",
];

const DICE_GAME = "0x4b87dF81A498ed204590f9aF25b8889cd0cBC5f7";
const DICE_ABI = [
  "function getRound(bytes32 roundId) view returns (address player, uint256 stake, uint256 targetScaled, uint256 roll, uint256 netPayout, bool won, bool settled, uint64 createdAt, bool custodial)",
];

// VRF IDs from the 7 pending bets
const PENDING = [
  { betId: "cmnbf13px", vrfId: "31590577902644851194319342038958782869395587716061724137758041145096794586751", game: "KENO", roundId: "0xcb9f7f968b26a2117a3d0e78384749b87f707eb99d1bb86d7db7f372dd663f41" },
  { betId: "cmnbigh2l", vrfId: "68409350705903186662431108851816340166963008284424938257836705117404322544452", game: "DICE", roundId: "0x5e0ef812637cd05e6e4925a6b7b36902e195515ed970b40a729707b0d95ce779" },
  { betId: "cmnbjaxit", vrfId: "30661466684412322160030073072739614600002289312624681939800689345649828817811", game: "DICE", roundId: "0xb1c5fc1baf1b0f64f04e5dfc620a168ad2c7a451dc768cf882b2fd9edbc8e3be" },
  { betId: "cmnbjc54r", vrfId: "86287612381178102044732008726234097671594133270922564528088092541650953994520", game: "DICE", roundId: "0xe99580469afc4ca0e3245fd7e1f070de79b138cdcdc2e8d5b74f032eb309dd12" },
  { betId: "cmnbjfcjh", vrfId: "74593406203350938414566309317560769752341780891159730976703987335173885923855", game: "DICE", roundId: "0xccb7bddd4bcc2aaa9201c4bcc797b2b65559ced822f0d4f19aeb087ae44f46c6" },
];

async function main() {
  const [signer] = await ethers.getSigners();
  const rc   = new ethers.Contract(RC_PROXY, RC_ABI, signer);
  const dice = new ethers.Contract(DICE_GAME, DICE_ABI, signer);
  
  for (const p of PENDING) {
    const req = await rc.requests(BigInt(p.vrfId));
    console.log(`\n[${p.game}] betId=${p.betId}`);
    console.log(`  RC fulfilled: ${req.fulfilled}`);
    
    if (p.game === "DICE") {
      try {
        const round = await dice.getRound(p.roundId as `0x${string}`);
        console.log(`  Dice settled: ${round.settled}, won: ${round.won}, roll: ${round.roll}`);
      } catch (e) { console.log("  Dice getRound error:", (e as Error).message?.slice(0, 100)); }
    }
    
    // Try staticCall of manualFulfill
    const RC_FULL = new ethers.Contract(RC_PROXY, [
      ...RC_ABI,
      "function manualFulfill(uint256 vrfRequestId, uint256 randomWord) external",
    ], signer);
    try {
      await RC_FULL.manualFulfill.staticCall(BigInt(p.vrfId), 12345678n);
      console.log(`  manualFulfill sim: ✓ PASSES`);
    } catch (e: any) { 
      console.log(`  manualFulfill sim: ✗ FAILS — ${e.message?.slice(0, 200)}`);
    }
  }
}
main().catch(console.error);
