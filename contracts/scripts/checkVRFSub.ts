import { ethers } from "hardhat";

const VRF_COORDINATOR = "0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf2";
const RC_PROXY        = "0x5A8b5C504743b7cd4A26adED19B77bA5B0421B67";
const SUB_ID          = "37121473965311191308103942488437766006292923759699378585569059143270839490077";

const VRF_ABI = [
  "function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] consumers)",
  "function pendingRequestExists(uint256 subId) view returns (bool)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const coord = new ethers.Contract(VRF_COORDINATOR, VRF_ABI, signer);

  console.log("\n── Chainlink VRF Subscription ─────────────────");
  const sub = await coord.getSubscription(BigInt(SUB_ID));
  console.log("  LINK balance   :", ethers.formatEther(sub.balance), "LINK");
  console.log("  Native balance :", ethers.formatEther(sub.nativeBalance), "MATIC");
  console.log("  Request count  :", sub.reqCount.toString());
  console.log("  Owner          :", sub.subOwner);
  console.log("  Consumers      :", sub.consumers);

  const rcRegistered = (sub.consumers as string[]).map((c: string) => c.toLowerCase()).includes(RC_PROXY.toLowerCase());
  console.log(`\n  RC registered as consumer? ${rcRegistered ? "✓ YES" : "✗ NO — MUST ADD RC AS CONSUMER!"}`);

  const pending = await coord.pendingRequestExists(BigInt(SUB_ID));
  console.log("  pendingRequestExists:", pending);
  console.log("─────────────────────────────────────────\n");
}
main().catch(console.error);
