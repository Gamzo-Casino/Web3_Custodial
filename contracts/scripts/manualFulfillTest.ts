import { ethers } from "hardhat";

const RC_PROXY = "0x5A8b5C504743b7cd4A26adED19B77bA5B0421B67";
// dice bet cmnbigh2l
const VRF_ID   = "68409350705903186662431108851816340166963008284424938257836705117404322544452";

const RC_ABI = [
  "function manualFulfill(uint256 vrfRequestId, uint256 randomWord) external",
  "function requests(uint256 vrfRequestId) view returns (bytes32 gameId, address gameContract, bytes32 roundId, bool fulfilled)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const rc = new ethers.Contract(RC_PROXY, RC_ABI, signer);
  
  const randomWord = ethers.hexlify(ethers.randomBytes(32));
  console.log("Sending manualFulfill tx...");
  console.log("randomWord:", randomWord);
  
  const tx = await rc.manualFulfill(BigInt(VRF_ID), BigInt(randomWord), { gasLimit: 500_000 });
  console.log("Tx hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("Status:", receipt.status === 1 ? "✓ SUCCESS" : "✗ REVERTED");
  
  // Verify
  const req = await rc.requests(BigInt(VRF_ID));
  console.log("Now fulfilled:", req.fulfilled);
}
main().catch(console.error);
