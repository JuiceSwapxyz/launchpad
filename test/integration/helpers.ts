import hre from "hardhat";
import { ADDRESS as JUSD_ADDRESS } from "@juicedollar/jusd";
import {
  V2_FACTORY_ADDRESSES,
  V2_ROUTER_ADDRESSES,
} from "@juiceswapxyz/sdk-core";

// Top-level await - Hardhat 3.0 pattern
// Export ethers so test file uses same connection
const networkConnection = await hre.network.connect();
export const ethers = networkConnection.ethers;

// Chain IDs
const CITREA_TESTNET_CHAIN_ID = 5115;
const CITREA_MAINNET_CHAIN_ID = 4114;

/**
 * Get chain ID based on current network.
 * - forkMainnet, citreaMainnet → 4114 (mainnet)
 * - forkTestnet, citreaTestnet, hardhat → 5115 (testnet)
 */
function getChainId(): number {
  const networkName = hre.globalOptions.network ?? "hardhat";
  if (networkName === "forkMainnet" || networkName === "citreaMainnet") {
    return CITREA_MAINNET_CHAIN_ID;
  }
  return CITREA_TESTNET_CHAIN_ID;
}

// Dead address for LP burn verification
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

// Get addresses from packages (single source of truth)
// Chain ID determined dynamically based on network
const chainId = getChainId();
const jusdAddresses = JUSD_ADDRESS[chainId];
export const SUSD_ADDRESS = jusdAddresses.startUSD;
export const STABLECOIN_BRIDGE = jusdAddresses.bridgeStartUSD;
export const JUSD_TOKEN_ADDRESS = jusdAddresses.juiceDollar;
export const V2_ROUTER_ADDRESS = V2_ROUTER_ADDRESSES[chainId];
export const V2_FACTORY_ADDRESS = V2_FACTORY_ADDRESSES[chainId];

// Minimal ABIs
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
];

const BRIDGE_ABI = ["function mint(uint256 amount) external"];

/**
 * Check if running on a forked network
 */
export function isForkMode(): boolean {
  const networkName = hre.globalOptions.network ?? "hardhat";
  return networkName === "forkTestnet" || networkName === "forkMainnet";
}

/**
 * Check if running on live testnet
 */
export function isTestnet(): boolean {
  const networkName = hre.globalOptions.network ?? "hardhat";
  return networkName === "citreaTestnet";
}

/**
 * Get required environment variable or throw
 */
export function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Set ERC20 token balance directly using hardhat_setStorageAt.
 * Works by computing the storage slot for the balance mapping and setting it.
 * @param tokenAddress - The ERC20 token contract address
 * @param account - The account to set balance for
 * @param amount - The balance amount to set
 * @param balanceSlot - The storage slot of the balances mapping (default 0 for OZ ERC20)
 */
export async function setTokenBalance(
  tokenAddress: string,
  account: string,
  amount: bigint,
  balanceSlot: number = 0,
): Promise<void> {
  // Compute storage slot: keccak256(abi.encode(account, balanceSlot))
  const slot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [account, balanceSlot],
    ),
  );

  // Set the storage value
  const value = ethers.toBeHex(amount, 32);
  await ethers.provider.send("hardhat_setStorageAt", [
    tokenAddress,
    slot,
    value,
  ]);
}

/**
 * Fund an account with JUSD by bridging SUSD.
 * SUSD is a simple ERC20 (not proxy) so storage slot 0 works.
 * Then we bridge SUSD → JUSD using StablecoinBridge.
 */
export async function fundWithJUSD(signer: any, amount: bigint): Promise<void> {
  const signerAddress = await signer.getAddress();

  // 1. Give test account SUSD using storage slot manipulation
  // SUSD is a simple ERC20 with balances at slot 0
  await setTokenBalance(SUSD_ADDRESS, signerAddress, amount, 0);

  // Verify SUSD balance was set
  const susd = new ethers.Contract(SUSD_ADDRESS, ERC20_ABI, signer);
  const susdBalance = await susd.balanceOf(signerAddress);
  if (susdBalance === 0n) {
    throw new Error("Failed to set SUSD balance");
  }
  log(`Set SUSD balance: ${formatTokens(susdBalance)}`);

  // 2. Approve bridge to spend SUSD
  const approveTx = await susd.approve(STABLECOIN_BRIDGE, amount);
  await approveTx.wait();

  // 3. Bridge SUSD → JUSD
  const bridge = new ethers.Contract(STABLECOIN_BRIDGE, BRIDGE_ABI, signer);
  const mintTx = await bridge.mint(amount);
  await mintTx.wait();

  log(`Bridged ${formatTokens(amount)} SUSD → JUSD`);
}

/**
 * Get a signer with JUSD balance for testing
 * - Fork mode: Uses first Hardhat signer, funds via SUSD → JUSD bridge
 * - Testnet: Uses the PRIVATE_KEY wallet (must have JUSD already)
 */
export async function getTestSigner() {
  const [signer] = await ethers.getSigners();

  if (isForkMode()) {
    const testAmount = ethers.parseEther("100000"); // 100k JUSD for testing
    await fundWithJUSD(signer, testAmount);
  }

  return signer;
}

/**
 * Format large numbers for logging
 */
export function formatTokens(amount: bigint, decimals: number = 18): string {
  return ethers.formatUnits(amount, decimals);
}

/**
 * Log with prefix for better test output
 */
export function log(message: string): void {
  console.log(`    [Integration] ${message}`);
}

/**
 * Deploy TokenFactory and implementation for fork testing.
 * Uses addresses from packages (single source of truth).
 */
export async function deployFactory() {
  const [deployer] = await ethers.getSigners();

  // Use addresses from packages
  const baseAssetAddress = JUSD_TOKEN_ADDRESS;
  const routerAddress = V2_ROUTER_ADDRESS;
  const permit2Address =
    process.env.PERMIT2_ADDRESS || "0x000000000022D473030F116dDEE9F6B43aC78BA3";
  const initialVirtualBase = ethers.parseEther(
    process.env.INITIAL_VIRTUAL_BASE || "4500",
  );

  // Fetch init code hash from V2 factory contract
  log("Fetching INIT_CODE_HASH from V2 Factory...");
  const v2Factory = await ethers.getContractAt(
    ["function INIT_CODE_PAIR_HASH() view returns (bytes32)"],
    V2_FACTORY_ADDRESS,
  );
  const initCodeHash = await v2Factory.INIT_CODE_PAIR_HASH();
  log(`Init Code Hash: ${initCodeHash}`);

  log("Deploying BondingCurveToken implementation...");
  const BondingCurveToken =
    await ethers.getContractFactory("BondingCurveToken");
  const implementation = await BondingCurveToken.deploy();
  await implementation.waitForDeployment();
  const implementationAddress = await implementation.getAddress();
  log(`Implementation: ${implementationAddress}`);

  log("Deploying TokenFactory...");
  const TokenFactory = await ethers.getContractFactory("TokenFactory");
  const factory = await TokenFactory.deploy(
    implementationAddress,
    routerAddress,
    baseAssetAddress,
    permit2Address,
    deployer.address, // fee recipient
    initialVirtualBase,
    initCodeHash,
  );
  await factory.waitForDeployment();

  return factory;
}
