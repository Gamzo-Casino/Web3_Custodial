import { ethers } from "hardhat";

const DICE_GAME    = "0x4b87dF81A498ed204590f9aF25b8889cd0cBC5f7";
const PLINKO_GAME  = "0x8e10fE2d7E642d21eAd14ff52F2ADD38e00c23de";
const KENO_GAME    = "0x44dC17d94345B4970caCecF7954AB676A25c6125";
const ROULETTE_GAME= "0x13CeBf51251547A048DF83A5561a0361822e298b";

const DICE_ABI  = ["function getRound(bytes32) view returns (address,uint256,uint256,uint256,uint256,bool,bool,uint64,bool)"];
const PLINKO_ABI= ["function getRound(bytes32) view returns (address,uint256,uint8,uint8,uint256,uint256,uint256,uint256,bool,uint64,bool)"];

const CHECKS = [
  { game: "DICE",    address: DICE_GAME,    betId: "cmnbigh2l", roundId: "0x5e0ef812637cd05e6e4925a6b7b36902e195515ed970b40a729707b0d95ce779" },
  { game: "DICE",    address: DICE_GAME,    betId: "cmnbjaxit", roundId: "0xb1c5fc1baf1b0f64f04e5dfc620a168ad2c7a451dc768cf882b2fd9edbc8e3be" },
  { game: "DICE",    address: DICE_GAME,    betId: "cmnbjc54r", roundId: "0xe99580469afc4ca0e3245fd7e1f070de79b138cdcdc2e8d5b74f032eb309dd12" },
  { game: "PLINKO",  address: PLINKO_GAME,  betId: "cmnbjcqle", roundId: "0x3bd08b4e220998dacf60ccc15a93faa7dcc964338c06dac68838ca0ad1492e70" },
  { game: "DICE",    address: DICE_GAME,    betId: "cmnbjfcjh", roundId: "0xccb7bddd4bcc2aaa9201c4bcc797b2b65559ced822f0d4f19aeb087ae44f46c6" },
];

async function main() {
  const [signer] = await ethers.getSigners();
  for (const c of CHECKS) {
    const abi = c.game === "PLINKO" ? PLINKO_ABI : DICE_ABI;
    const game = new ethers.Contract(c.address, abi, signer);
    const round = await game.getRound(c.roundId as `0x${string}`);
    // settled is at index 6 for dice (7th field), index 8 for plinko
    const settled = c.game === "PLINKO" ? round[8] : round[6];
    const won     = c.game === "PLINKO" ? undefined : round[5];
    console.log(`[${c.game}] ${c.betId}: settled=${settled}${won !== undefined ? `, won=${won}` : ""}`);
  }
  console.log("\nAll rounds on-chain are settled. Frontend status polling will credit DB on next poll.");
}
main().catch(console.error);
