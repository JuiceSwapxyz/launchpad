# Launchpad

Token launchpad with bonding curve mechanism and automatic DEX graduation for JuiceSwap on Citrea.

## Overview

Tokens launch on a constant-product bonding curve. When fully sold, they automatically graduate to JuiceSwap V2 with permanently locked liquidity.

- All tokens trade against JUSD (Juice Dollar)
- Graduation creates TOKEN/JUSD pairs on JuiceSwap V2
- LP tokens burned to `0xdead` (permanent lock)

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
test/
├── BondingCurveToken.test.ts
├── TokenFactory.test.ts
└── Graduation.test.ts
scripts/
└── deploy.ts
```

## Usage

### Environment

Copy `.env.example` to `.env` and set:

```
PRIVATE_KEY=
CITREA_TESTNET_RPC=https://rpc.testnet.citrea.xyz
CITREA_MAINNET_RPC=https://rpc.citrea.xyz
UNISWAP_V2_ROUTER=           # JuiceSwap router
BASE_ASSET_ADDRESS=          # JUSD address
INIT_CODE_HASH=              # V2 factory init code hash
FEE_RECIPIENT=               # Optional, defaults to deployer
INITIAL_VIRTUAL_BASE=4500    # Optional, in JUSD units
```

### Commands

```bash
npm install
npm run compile
npm test
npm run test:coverage
npm run deploy:testnet
npm run deploy:mainnet
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
