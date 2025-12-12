/**
 * Launchpad protocol constants
 * These match the values in the BondingCurveToken contract
 */
export const LAUNCHPAD_CONSTANTS = {
  /** Total supply of each token (1 billion) */
  TOTAL_SUPPLY: 1_000_000_000n * 10n ** 18n,

  /** Initial virtual token reserves for pricing (1.073 billion) */
  INITIAL_VIRTUAL_TOKEN_RESERVES: 1_073_000_000n * 10n ** 18n,

  /** Real tokens available for bonding curve sales (793.1 million) */
  INITIAL_REAL_TOKEN_RESERVES: 793_100_000n * 10n ** 18n,

  /** Tokens reserved for Uniswap V2 liquidity at graduation (206.9 million) */
  RESERVED_FOR_DEX: 206_900_000n * 10n ** 18n,

  /** Trading fee in basis points (1% = 100 bps) */
  FEE_BPS: 100n,

  /** Basis points denominator (10,000 = 100%) */
  BPS_DENOMINATOR: 10_000n,
} as const;

/**
 * Economics at graduation (approximate values)
 * Derived from constant product formula with default 4500 JUSD virtual base
 */
export const GRADUATION_ECONOMICS = {
  /** Approximate base asset collected at graduation */
  BASE_COLLECTED: 12_750n * 10n ** 18n,

  /** Approximate market cap in base asset terms */
  MARKET_CAP: 61_650n * 10n ** 18n,

  /** Approximate V2 liquidity value (both sides) */
  V2_LIQUIDITY: 25_501n * 10n ** 18n,

  /** Price multiplier from start to graduation */
  PRICE_MULTIPLIER: 147n, // 14.7x (scaled by 10)
} as const;

/**
 * Dead address for LP token burns
 */
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;
