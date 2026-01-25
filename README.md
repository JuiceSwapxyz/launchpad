# @juiceswapxyz/launchpad

Token launchpad with bonding curve mechanism and automatic DEX graduation for JuiceSwap on Citrea.

## Installation

```bash
npm install @juiceswapxyz/launchpad
```

## Overview

Tokens launch on a constant-product bonding curve. When fully sold, they automatically graduate to JuiceSwap V2 with permanently locked liquidity.

- All tokens trade against JUSD (Juice Dollar)
- Graduation creates TOKEN/JUSD pairs on JuiceSwap V2
- LP tokens burned to `0xdead` (permanent lock)

## Frontend Integration

### Exports

| Export | Description |
|--------|-------------|
| `TokenFactoryABI` | ABI for creating tokens and querying factory |
| `BondingCurveTokenABI` | ABI for buy/sell/graduate operations |
| `ADDRESS` | Contract addresses by chain ID |
| `LAUNCHPAD_CONSTANTS` | Protocol constants (supply, reserves, fees) |
| `getAddresses(chainId)` | Helper to get addresses for a chain |
| `isChainSupported(chainId)` | Check if chain is supported |

### Usage

```typescript
import { TokenFactoryABI, ADDRESS } from '@juiceswapxyz/launchpad';
import { getContract } from 'viem';

const factory = getContract({
  address: ADDRESS[5115].factory, // Citrea Testnet
  abi: TokenFactoryABI,
  client: publicClient,
});

const hash = await factory.write.createToken([
  'My Token',
  'MTK',
  'ipfs://QmW2WQi7j6c7UgJTarActp7tDNikE4B2qXtFCfLPdsgaTQ'
]);
```

## Token Metadata

All tokens **MUST** include metadata when created. Metadata provides essential token information (logo, description, social links) and is **immutable** after creation.

### Storage Options

**IPFS (Recommended)**
- Decentralized, content-addressed storage
- Industry standard for token metadata
- Format: `ipfs://Qm...`
- Services: [Pinata](https://pinata.cloud), Web3.Storage, Infura

**Arweave**
- Permanent pay-once storage
- Format: `ar://...`

**HTTPS (Not Recommended)**
- Centralized, mutable, can disappear
- Only use for testing

### Metadata JSON Structure

The metadata follows the [OpenSea Metadata Standard](https://docs.opensea.io/docs/metadata-standards):

```json
{
  "name": "My Awesome Token",
  "description": "A revolutionary token launching on Citrea with fair bonding curve distribution",
  "image": "ipfs://QmImageHash.../logo.png",
  "external_url": "https://mytoken.com",
  "attributes": [
    { "trait_type": "Category", "value": "Meme" },
    { "trait_type": "Network", "value": "Citrea" }
  ],
  "properties": {
    "website": "https://mytoken.com",
    "twitter": "https://twitter.com/mytoken",
    "telegram": "https://t.me/mytoken",
    "discord": "https://discord.gg/mytoken"
  }
}
```

**Required Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Token name (should match on-chain name) |
| `description` | string | Token purpose and value proposition (100-500 chars recommended) |
| `image` | URI | Logo/avatar (512x512px PNG/SVG, IPFS recommended) |

**Optional Fields:**

- `external_url` - Project website
- `attributes` - Categorical traits for filtering (e.g., Category, Network, Launch Type)
- `properties` - Social links and additional metadata (twitter, telegram, discord, whitepaper, etc.)

### Security Constraints

The contract enforces these validation rules:

| Field | Maximum | Validation |
|-------|---------|------------|
| **Name** | 100 characters | No control characters (0x00-0x1F, 0x7F), allows Unicode |
| **Symbol** | 20 characters | Uppercase A-Z and 0-9 only |
| **Metadata URI** | 1,024 bytes | No control characters |

**Forbidden Characters:**
- Null bytes (`\x00`)
- Control characters (`\x01-\x1F`) - newline, tab, escape codes, etc.
- DEL character (`\x7F`)

**Allowed:**
- ASCII printable characters (0x20-0x7E) ✅
- Unicode characters (emoji, international text) ✅
- URL encoding (%, &, =) ✅

### Contract Behavior

**What the contract validates:**
- ✅ Metadata URI is non-empty
- ✅ URI length ≤ 1KB
- ✅ No control characters in URI
- ✅ Name/symbol length limits
- ✅ Symbol contains only A-Z, 0-9

**What the contract does NOT validate:**
- ❌ URI format or reachability
- ❌ JSON structure or content
- ❌ Image existence or validity

**Note:** Metadata is **immutable** after token creation (prevents rug pulls). Content validation is the responsibility of frontends and indexers.

### How to Upload Metadata

**Option 1: Pinata (Easiest)**

1. Sign up at [pinata.cloud](https://pinata.cloud)
2. Upload logo image → copy IPFS hash (e.g., `QmImageHash...`)
3. Create `metadata.json` with image URI: `ipfs://QmImageHash...`
4. Upload `metadata.json` → copy metadata hash (e.g., `QmMetadataHash...`)
5. Use metadata hash when creating token: `ipfs://QmMetadataHash...`

**Option 2: IPFS CLI**

```bash
# Upload image
ipfs add logo.png
# Returns: QmImageHash...

# Create metadata.json
cat > metadata.json <<EOF
{
  "name": "My Token",
  "description": "Token description here",
  "image": "ipfs://QmImageHash..."
}
EOF

# Upload metadata
ipfs add metadata.json
# Returns: QmMetadataHash...
```

### Creating a Token

```typescript
import { TokenFactoryABI, ADDRESS } from '@juiceswapxyz/launchpad';

// After uploading metadata to IPFS
const metadataURI = "ipfs://QmMetadataHash...";

const hash = await factory.write.createToken([
  'My Awesome Token',
  'MAT',
  metadataURI
]);
```

### Fetching Metadata in Frontend

```typescript
// Fetch metadata from IPFS using public gateway
async function fetchMetadata(uri: string) {
  if (uri.startsWith('ipfs://')) {
    const hash = uri.replace('ipfs://', '');
    const url = `https://ipfs.io/ipfs/${hash}`;
    const response = await fetch(url);
    return await response.json();
  }

  if (uri.startsWith('ar://')) {
    const id = uri.replace('ar://', '');
    const url = `https://arweave.net/${id}`;
    const response = await fetch(url);
    return await response.json();
  }

  // HTTPS - direct fetch
  return await fetch(uri).then(r => r.json());
}
```

**Tip:** Use multiple IPFS gateways for reliability (ipfs.io, cloudflare-ipfs.com, gateway.pinata.cloud).

### Best Practices

✅ **Use IPFS** for permanent, decentralized storage
✅ **Include all required fields** (name, description, image)
✅ **Add social links** in properties for community discovery
✅ **Use high-quality images** (512x512px minimum, PNG/SVG)
✅ **Pin IPFS content** to ensure availability (use Pinata, Infura, Web3.Storage)
✅ **Test metadata** before deploying token
❌ **Don't use HTTPS** for production (centralized, can disappear)
❌ **Don't include sensitive info** in metadata (all public)

### FAQ

**Can I update metadata after token creation?**
No. Metadata is immutable to prevent rug pulls and maintain trust.

**What if my IPFS content becomes unavailable?**
Pin your content on multiple IPFS nodes or use pinning services (Pinata, Infura, Web3.Storage).

**Does the contract validate my JSON structure?**
No. Only the URI format is validated. Content validation (JSON parsing, required fields) is the responsibility of frontends and indexers.

**What image formats and sizes are supported?**
PNG and SVG are recommended. Keep file size under 500KB. Minimum 512x512px for logos. Animated PNGs (APNG) and animated SVGs are supported.

## Contracts

| Contract | Description |
|----------|-------------|
| `TokenFactory.sol` | Factory using EIP-1167 minimal proxies |
| `BondingCurveToken.sol` | ERC20 with bonding curve and graduation |

## Bonding Curve

### Constants

| Parameter | Value | Description |
|-----------|-------|-------------|
| Total Supply | 1,000,000,000 | Fixed supply per token |
| Virtual Token Reserves | 1,073,000,000 | For pricing curve |
| Virtual Base Reserves | Configurable (default 4,500 JUSD) | Initial virtual liquidity |
| Real Token Reserves | 793,100,000 | 79.31% sold on curve |
| Reserved for DEX | 206,900,000 | 20.69% for V2 LP |
| Fee | 1% (100 bps) | On input (buy) / output (sell) |

### Formulas

**Buy** (fee from input):
```
baseInAfterFee = baseIn - (baseIn * 1%)
tokensOut = virtualTokenReserves - (k / (virtualBaseReserves + baseInAfterFee))
```

**Sell** (fee from output):
```
baseOutBeforeFee = virtualBaseReserves - (k / (virtualTokenReserves + tokensIn))
baseOut = baseOutBeforeFee - (baseOutBeforeFee * 1%)
```

Where `k = virtualBaseReserves * virtualTokenReserves`

### Graduation

Triggered when `realTokenReserves == 0` (all tokens sold from curve).

1. Add liquidity: 206.9M tokens + collected JUSD to V2
2. Burn LP tokens to `0xdead`
3. Transfer accumulated fees to fee recipient

## Fees

- 1% fee on all buy/sell transactions
- Fees accumulate during bonding curve phase
- Sent to `feeRecipient` at graduation

## Repository Structure

```
contracts/
├── BondingCurveToken.sol
├── TokenFactory.sol
└── mocks/                    # Test mocks only
exports/
├── index.ts                  # Barrel export
├── address.config.ts         # Chain addresses
├── constants.ts              # Protocol constants
└── abis/
    ├── TokenFactory.ts
    └── BondingCurveToken.ts
test/
├── BondingCurveToken.test.ts
├── TokenFactory.test.ts
├── Graduation.test.ts
└── integration/              # Fork tests
scripts/
├── deploy.ts
└── exportAbis.ts
```

## Usage

### Environment

Copy `.env.example` to `.env` and set:

```
PRIVATE_KEY=
CITREA_TESTNET_RPC=https://rpc.testnet.citrea.xyz
CITREA_MAINNET_RPC=https://rpc.citrea.xyz

# Optional
FEE_RECIPIENT=               # Defaults to deployer
INITIAL_VIRTUAL_BASE=4500    # Virtual base reserves in JUSD
```

> **Note:** Most addresses (JUSD, V2 Router, INIT_CODE_HASH) are now auto-imported from `@juicedollar/jusd` and `@juiceswapxyz/sdk-core` packages.

### Commands

```bash
npm install
npm run compile          # Compile contracts
npm test                 # Run unit tests
npm run test:coverage    # Run with coverage
npm run test:fork        # Run tests on local testnet fork
npm run test:integration:fork  # Run integration tests on local testnet fork
npm run deploy:fork      # Deploy to local testnet fork
npm run deploy:testnet   # Deploy to Citrea Testnet
npm run deploy:mainnet   # Deploy to Citrea Mainnet
npm run build            # Build npm package (exports ABIs)
```

**Fork Networks:**

For local development with real contract state, use fork networks:

```bash
# Fork Citrea Testnet locally (uses real JUSD, V2 Router, etc.)
npx hardhat run scripts/deploy.ts --network forkTestnet

# Fork Citrea Mainnet locally
npx hardhat run scripts/deploy.ts --network forkMainnet
```

### After Deployment

After deploying contracts, update `exports/address.config.ts` with the new addresses from your deployment output:

```typescript
// Citrea Testnet
5115: {
  factory: "0x...",        // TokenFactory address
  implementation: "0x...", // BondingCurveToken implementation
  baseAsset: "0x...",      // JUSD address (from @juicedollar/jusd)
  router: "0x...",         // JuiceSwap V2 Router (from @juiceswapxyz/sdk-core)
  feeRecipient: "0x...",   // Fee recipient (usually deployer)
  initCodeHash: "0x...",   // V2 factory init code hash (from @juiceswapxyz/sdk-core)
},
```

### Publishing

After updating addresses, build and publish:

```bash
npm run build            # Export ABIs + bundle package
npm publish --access public
```

To manually export ABIs without publishing:
```bash
npm run ts:export:abis   # Export ABIs only
npm run build            # Export ABIs + bundle package
```

## Security

### Audited Dependencies
- OpenZeppelin Contracts v5.4.0 (ERC20, ReentrancyGuard, Ownable, Pausable, Clones)
- Uniswap V2 Core/Periphery

### Requires Audit
- `BondingCurveToken.sol` - bonding curve logic, graduation mechanism
- `TokenFactory.sol` - proxy deployment

### Protections
- Reentrancy guards on all state-changing functions
- Slippage protection via `minTokensOut` / `minBaseOut`
- Single initialization (proxy pattern)
- Front-running protection (blocks transfers to V2 pair before graduation)

## References

- [pump.fun docs](https://github.com/pump-fun/pump-public-docs)
- [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts)
- [Uniswap V2](https://github.com/Uniswap/v2-core)
- [Citrea Docs](https://docs.citrea.xyz)

## License

MIT
