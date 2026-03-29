import { ethers } from "hardhat";

const RC_PROXY = "0x5A8b5C504743b7cd4A26adED19B77bA5B0421B67";
// One of the stuck VRF request IDs
const VRF_REQUEST_ID = "68409350705903186662431108851816340166963008284424938257836705117404322544452";
const RANDOM_WORD = "12345678901234567890";

const RC_ABI = [
  "function manualFulfill(uint256 vrfRequestId, uint256 randomWord) external",
  "function requests(uint256 vrfRequestId) view returns (bytes32 gameId, address gameContract, bytes32 roundId, bool fulfilled)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  
  const rc = new ethers.Contract(RC_PROXY, RC_ABI, deployer);
  
  // Check admin role
  const adminRole = await rc.DEFAULT_ADMIN_ROLE();
  const hasAdmin = await rc.hasRole(adminRole, deployer.address);
  console.log("Has DEFAULT_ADMIN_ROLE:", hasAdmin);
  
  // Check the request
  const req = await rc.requests(BigInt(VRF_REQUEST_ID));
  console.log("Request:", {
    gameId: req.gameId,
    gameContract: req.gameContract,
    roundId: req.roundId,
    fulfilled: req.fulfilled
  });
  
  // Try to simulate
  try {
    await rc.manualFulfill.staticCall(BigInt(VRF_REQUEST_ID), BigInt(RANDOM_WORD));
    console.log("✓ Simulation passed");
  } catch (err: any) {
    console.log("✗ Simulation failed:", err.message?.slice(0, 300));
  }
  
  // Try to estimate gas (will fail with reason)
  try {
    const gas = await rc.manualFulfill.estimateGas(BigInt(VRF_REQUEST_ID), BigInt(RANDOM_WORD));
    console.log("Gas estimate:", gas.toString());
  } catch (err: any) {
    console.log("Gas estimate failed:", err.message?.slice(0, 500));
  }
}
main().catch(console.error);
// This block won't run since main() is already defined above, but let's make a new script
