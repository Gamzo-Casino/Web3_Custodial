# Gamzo Web3 — Deployment Guide

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                    │
│  RainbowKit · wagmi · viem · TanStack Query             │
│  Wallet connect → SIWE auth → DB user keyed by address  │
└──────────────────┬──────────────────────────────────────┘
                   │ read/write
┌──────────────────▼──────────────────────────────────────┐
│               Smart Contracts (Polygon Amoy)             │
│                                                          │
│  GZOToken (ERC-20, UUPS)  ←→  TreasuryVault (UUPS)     │
│                                     ↕                    │
│  GameRegistry (UUPS)       CoinFlipGame (UUPS)          │
│                             DiceGame    (UUPS)           │
│  RandomnessCoordinator  ←── + future games...           │
│  (Chainlink VRF v2.5)                                   │
└──────────────────┬──────────────────────────────────────┘
                   │ event indexing
┌──────────────────▼──────────────────────────────────────┐
│              PostgreSQL (indexed read cache)             │
│  GameBet + onchainRoundId + txHash + blockNumber        │
│  User + walletAddress + chainId                         │
└─────────────────────────────────────────────────────────┘
```

## Local Development (Hardhat)

### 1. Start Hardhat node
```bash
cd contracts
npm install
npx hardhat node
```

### 2. Deploy contracts (in a new terminal)
```bash
cd contracts
npx hardhat run scripts/deploy.ts --network localhost
# ✅ Writes deployed-addresses.json to src/lib/web3/deployed-addresses.json automatically
```

### 3. Start Next.js
```bash
# In project root
npm install
npx next dev
```

### 4. Configure MetaMask for Hardhat
- Network name: Hardhat Local
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency: `ETH`

### 5. Import a test wallet
Use Hardhat Account #0 private key:
`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

### 6. Get test GZO
Call the faucet — each call mints 10,000 GZO:
- Connect wallet on the app
- Or call directly: `npx hardhat console --network localhost` then:
  ```js
  const gzo = await ethers.getContractAt("GZOToken", "<GZO_ADDRESS>");
  await gzo.faucet(); // mints to msg.sender
  ```

---

## Polygon Amoy Testnet Deployment

### Prerequisites
1. **MATIC on Amoy** — get from [Polygon Faucet](https://faucet.polygon.technology/)
2. **Chainlink VRF subscription** — create at [vrf.chain.link](https://vrf.chain.link/) on Amoy
3. **Polygonscan API key** — optional but recommended for verification

### Set environment variables in `contracts/.env`
```bash
DEPLOYER_PRIVATE_KEY=0x_your_key
AMOY_RPC_URL=https://rpc-amoy.polygon.technology
VRF_COORDINATOR=0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf
VRF_KEY_HASH=0x816bedba8a50b294e5cbd47842baf240c2385f2eaf719edbd4f250a137a8c899
VRF_SUBSCRIPTION_ID=<your_subscription_id>
POLYGONSCAN_API_KEY=<optional>
```

### Set Next.js env in `.env.local`
```bash
NEXT_PUBLIC_CHAIN_ID=80002
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<your_wc_project_id>
```

### Deploy
```bash
cd contracts
npm run deploy:amoy
# ✅ Writes deployed-addresses.json to src/lib/web3/deployed-addresses.json
```

### After deploy: fund the treasury
```bash
npx hardhat console --network amoy
> const gzo = await ethers.getContractAt("GZOToken", "<GZO_ADDRESS>")
> const treasury = await ethers.getContractAt("TreasuryVault", "<TREASURY_ADDRESS>")
> await gzo.mint("<TREASURY_ADDRESS>", ethers.parseEther("1000000"))
```

### Add deployed contract as VRF consumer
In the Chainlink VRF dashboard, add `RandomnessCoordinator` address as a consumer of your subscription.

---

## Smart Contract Addresses (localhost, last deploy)

These are written automatically to `src/lib/web3/deployed-addresses.json` after each deploy.

| Contract | Address |
|---|---|
| GZOToken | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| TreasuryVault | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` |
| GameRegistry | `0x0165878A594ca255338adfa4d48449f69242Eb8F` |
| RandomnessCoordinator | `0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6` |
| CoinFlipGame | `0x610178dA211FEF7D417bC0e6FeD39F05609AD788` |
| DiceGame | `0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0` |

---

## Upgrading Contracts

```bash
cd contracts
# Edit the contract, then:
npx hardhat run scripts/upgrade.ts --network localhost   # or --network amoy
```

Upgrade script (create `scripts/upgrade.ts`):
```typescript
import { ethers, upgrades } from "hardhat";
import addresses from "../deployed-addresses.json";

async function main() {
  const CoinFlipV2 = await ethers.getContractFactory("CoinFlipGame");
  const upgraded = await upgrades.upgradeProxy(addresses.coinFlipGame, CoinFlipV2, { kind: "uups" });
  console.log("Upgraded CoinFlipGame at:", await upgraded.getAddress());
}
main().catch(console.error);
```

---

## Adding a New Game

1. Create `contracts/contracts/games/NewGame.sol` extending the same pattern as `DiceGame.sol`
2. Deploy it: `await upgrades.deployProxy(NewGame, [admin, treasury, coordinator, min, max])`
3. Grant roles:
   ```solidity
   treasury.grantRole(GAME_ROLE, newGameAddr);
   coordinator.grantRole(GAME_ROLE, newGameAddr);
   registry.registerGame(keccak256("NEWGAME"), newGameAddr);
   ```
4. Add ABI + address to `src/lib/web3/contracts.ts`
5. Create wagmi hooks in `src/lib/web3/hooks/useNewGame.ts`
6. Wire up the frontend page

---

## Running Tests

```bash
# Smart contract tests (Hardhat)
cd contracts && npx hardhat test

# Frontend tests (Jest)
cd .. && npx jest

# Type check
npx tsc --noEmit
```

---

## Security Notes

- **ReentrancyGuard** on all money-critical functions in TreasuryVault and game contracts
- **AccessControl** with distinct roles (GAME_ROLE, PAUSER_ROLE, UPGRADER_ROLE, FEE_ROLE)
- **Pausable** on TreasuryVault and all game contracts
- **SafeERC20** for all token transfers
- **UUPS upgradeability** — `_authorizeUpgrade` requires UPGRADER_ROLE
- **No self-join** — CoinFlipGame rejects playerA joining their own match
- **Solvency check** — `treasury.canPay(amount)` before accepting any bet
- **VRF-only settlement** — only `RandomnessCoordinator` can call `fulfillRandomness`
- **Nonce-based round IDs** — `keccak256(player, nonce, timestamp)` prevents collision
