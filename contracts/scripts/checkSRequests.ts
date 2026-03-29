import { ethers } from "hardhat";

const RC_PROXY = "0x5A8b5C504743b7cd4A26adED19B77bA5B0421B67";
const RC_ABI = [
  "function s_requests(uint256 vrfId) view returns (bool fulfilled, bool exists, uint256 randomWord)",
  "function requests(uint256 vrfId) view returns (bytes32 gameId, address gameContract, bytes32 roundId, bool fulfilled)",
];

// Previously fulfilled VRF IDs (manually fulfilled by our script)
const FULFILLED_IDS = [
  { game: "KENO",    id: "31590577902644851194319342038958782869395587716061724137758041145096794586751" },
  { game: "DICE",    id: "68409350705903186662431108851816340166963008284424938257836705117404322544452" },
  { game: "PLINKO",  id: "88608971769046001357309168846455986419349325603661751871900180541071855400385" },
];

async function main() {
  const [signer] = await ethers.getSigners();
  const rc = new ethers.Contract(RC_PROXY, RC_ABI, signer);

  console.log("\n── s_requests mapping (Chainlink v2.5 recommendation) ──");
  for (const { game, id } of FULFILLED_IDS) {
    const s = await rc.s_requests(BigInt(id));
    const r = await rc.requests(BigInt(id));
    console.log(`\n  [${game}] vrfId: ...${id.slice(-12)}`);
    console.log(`    s_requests.exists:     ${s.exists}`);
    console.log(`    s_requests.fulfilled:  ${s.fulfilled}`);
    console.log(`    s_requests.randomWord: ${s.randomWord.toString().slice(0, 20)}...`);
    console.log(`    requests.fulfilled:    ${r.fulfilled}`);
    console.log(`    requests.gameContract: ${r.gameContract}`);
  }

  // Note: s_requests.exists = false for requests made BEFORE this upgrade
  // (they were fulfilled before the mapping existed — that's expected)
  console.log("\n  NOTE: exists=false for pre-upgrade requests is expected.");
  console.log("  New requests placed after this upgrade will populate s_requests correctly.");
  console.log("────────────────────────────────────────────────────────\n");
}
main().catch(console.error);
