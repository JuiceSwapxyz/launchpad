import hre from "hardhat";

// Top-level await - Hardhat 3.0 pattern
// Export ethers so test file uses same connection
const networkConnection = await hre.network.connect();
export const ethers = networkConnection.ethers;

// Dead address for LP burn verification
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

// StablecoinBridge addresses (Citrea Testnet) - LATEST from JuiceDollar
export const SUSD_ADDRESS = "0xa37f823Bd1bae4379265A4fF9cD5a68f402dE2f5";
export const STABLECOIN_BRIDGE = "0x8c5e5594c05205454BC09487ad53db4e4DB6564D";

// Minimal ABIs
const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)",
];

const BRIDGE_ABI = [
    "function mint(uint256 amount) external",
];

/**
 * Check if running on a forked network
 */
export function isForkMode(): boolean {
    return process.env.FORK_CITREA === "true";
}

/**
 * Check if running on live testnet
 */
export function isTestnet(): boolean {
    return process.env.HARDHAT_NETWORK === "citreaTestnet" ||
           (!isForkMode() && process.env.CITREA_TESTNET_RPC !== undefined);
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
    balanceSlot: number = 0
): Promise<void> {
    // Compute storage slot: keccak256(abi.encode(account, balanceSlot))
    const slot = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256"],
            [account, balanceSlot]
        )
    );

    // Set the storage value
    const value = ethers.toBeHex(amount, 32);
    await ethers.provider.send("hardhat_setStorageAt", [tokenAddress, slot, value]);
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
 * Uses real JUSD and V2 Router addresses from the forked state.
 */
export async function deployFactory() {
    const [deployer] = await ethers.getSigners();

    // Use real addresses from forked state
    const baseAssetAddress = getEnvOrThrow("BASE_ASSET_ADDRESS");
    const routerAddress = getEnvOrThrow("UNISWAP_V2_ROUTER");
    const initCodeHash = getEnvOrThrow("INIT_CODE_HASH");
    const initialVirtualBase = ethers.parseEther(process.env.INITIAL_VIRTUAL_BASE || "4500");

    log("Deploying BondingCurveToken implementation...");
    const BondingCurveToken = await ethers.getContractFactory("BondingCurveToken");
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
        deployer.address, // fee recipient
        initialVirtualBase,
        initCodeHash
    );
    await factory.waitForDeployment();

    return factory;
}
