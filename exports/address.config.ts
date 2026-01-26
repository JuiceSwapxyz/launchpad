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
  // Citrea Testnet (deployed 2026-01-25)
  5115: {
    factory: "0xCf5b581064F27a0cFABbbD3E538aFf3b358665c4",
    implementation: "0xC46706007351AD7853159170fCC0489CCD04643D",
    baseAsset: "0x6a850a548fdd050e8961223ec8FfCDfacEa57E39", // JUSD
    router: "0x37164703eF51EcB49C9a565C233a277003aE483f", // JuiceSwap V2 Router
    feeRecipient: "0xaa90815Cb5250A868FDc914ADCbf26773126F550",
    initCodeHash: "0xdc3b9f52403077ec7261ad325e15f34e395cf7e2a5c3782098edb10a7599cc3e",
  },
  // Citrea Mainnet (deployed 2026-01-26)
  4114: {
    factory: "0xF5E06d37091a252A3Ae6BFd575D97635625028b9",
    implementation: "0xB8418EDc48c0a63a0Ab29F50BdE09552A8aECa0c",
    baseAsset: "0x0987D3720D38847ac6dBB9D025B9dE892a3CA35C", // JUSD
    router: "0x6BDea31C89E0A202cE84b5752BB2e827B39984ae", // JuiceSwap V2 Router
    feeRecipient: "0xECc0b131D481dE8aB538D19F04dD4b253660D82B",
    initCodeHash: "0xdc3b9f52403077ec7261ad325e15f34e395cf7e2a5c3782098edb10a7599cc3e",
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
