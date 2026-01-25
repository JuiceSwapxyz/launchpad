import { type Address, zeroAddress } from "viem";

export interface LaunchpadAddresses {
  /** TokenFactory contract address */
  factory: Address;
  /** BondingCurveToken implementation address */
  implementation: Address;
  /** Base asset (JUSD) address */
  baseAsset: Address;
  /** JuiceSwap V2 Router address */
  router: Address;
  /** Protocol fee recipient address */
  feeRecipient: Address;
  /** Init code hash for Uniswap V2 pair computation */
  initCodeHash: `0x${string}`;
}

/**
 * Launchpad contract addresses by chain ID
 * - 5115: Citrea Testnet
 * - 4114: Citrea Mainnet
 */
export const ADDRESS: Record<number, LaunchpadAddresses> = {
  // Citrea Testnet
  5115: {
    factory: "0xA72CbB319C62B7CA5988183c027533A1E7E33459",
    implementation: "0xB06B25afeeB48f9dddF42b471Ce54dB7480b581A",
    baseAsset: "0xFdB0a83d94CD65151148a131167Eb499Cb85d015", // JUSD
    router: "0x48bA9db1EAcDB7C97B7B601c1E213F29E996d974", // JuiceSwap V2 Router
    feeRecipient: "0xE399782Fe2B0aBb138926b14261F49473b4881A3",
    initCodeHash: "0xdc3b9f52403077ec7261ad325e15f34e395cf7e2a5c3782098edb10a7599cc3e",
  },
  // Citrea Mainnet - TODO: Update after mainnet deployment
  4114: {
    factory: zeroAddress,
    implementation: zeroAddress,
    baseAsset: zeroAddress,
    router: zeroAddress,
    feeRecipient: zeroAddress,
    initCodeHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  },
};

/**
 * Get launchpad addresses for a specific chain
 * @param chainId - The chain ID (5115 for testnet, 4114 for mainnet)
 * @returns LaunchpadAddresses or undefined if chain not supported
 */
export function getAddresses(chainId: number): LaunchpadAddresses | undefined {
  return ADDRESS[chainId];
}

/**
 * Check if a chain is supported
 * @param chainId - The chain ID to check
 * @returns true if the chain is supported and has valid addresses
 */
export function isChainSupported(chainId: number): boolean {
  const addresses = ADDRESS[chainId];
  return addresses !== undefined && addresses.factory !== zeroAddress;
}
