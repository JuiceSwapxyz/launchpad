import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";

const { ethers } = await hre.network.connect();

async function main() {
    console.log("\n🚀 Deploying Launchpad Contracts...\n");

    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);
    const networkName = hre.globalOptions.network ?? "hardhat";
    console.log("Network:", networkName);

    // Get network-specific configuration
    const isTestnet = networkName === "citreaTestnet";
    const isMainnet = networkName === "citreaMainnet";
    const isFork = process.env.FORK_CITREA === "true";

    let baseAssetAddress: string;
    let routerAddress: string;
    let feeRecipient: string;
    let initialVirtualBaseReserves: bigint;
    let initCodeHash: string;
    let decimals: number = 18;

    // Fee recipient (defaults to deployer if not set)
    feeRecipient = process.env.FEE_RECIPIENT || deployer.address;
    console.log("Fee Recipient Address:", feeRecipient);

    if (isTestnet || isFork) {
        console.log(isFork ? "\n🍴 Fork Deployment (using testnet config)" : "\n📝 Testnet Deployment");

        // Testnet requires BASE_ASSET_ADDRESS; fork mode allows mocks for testing
        if (process.env.BASE_ASSET_ADDRESS) {
            baseAssetAddress = process.env.BASE_ASSET_ADDRESS;
            console.log("Using existing Base Asset:", baseAssetAddress);
        } else if (isTestnet) {
            throw new Error(
                "BASE_ASSET_ADDRESS is required for testnet deployment.\n" +
                "Set it in .env to the real JUSD/base asset address.\n" +
                "For local testing with mocks, use: npm run deploy:fork"
            );
        } else {
            // Fork mode - deploy mock for testing
            console.log("Deploying mock WcBTC for testing...");
            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const baseAsset = await MockERC20.deploy("Wrapped cBTC", "WcBTC");
            await baseAsset.waitForDeployment();
            baseAssetAddress = await baseAsset.getAddress();
            console.log("✅ Mock WcBTC deployed:", baseAssetAddress);
        }

        // Use environment variable or deploy mock router/factory
        routerAddress = process.env.UNISWAP_V2_ROUTER || "";
        initCodeHash = process.env.INIT_CODE_HASH || "";

        if (!routerAddress) {
            console.log("⚠️  No UNISWAP_V2_ROUTER set, deploying mock V2 contracts...");

            // Deploy mock factory first (for init code hash)
            const MockFactory = await ethers.getContractFactory("MockUniswapV2Factory");
            const mockFactory = await MockFactory.deploy();
            await mockFactory.waitForDeployment();
            const factoryAddr = await mockFactory.getAddress();
            console.log("✅ Mock Factory deployed:", factoryAddr);

            // Get init code hash from factory
            initCodeHash = await mockFactory.INIT_CODE_PAIR_HASH();
            console.log("✅ Init Code Hash:", initCodeHash);

            // Deploy mock router with factory
            const MockRouter = await ethers.getContractFactory("MockUniswapV2Router");
            const mockRouter = await MockRouter.deploy(factoryAddr, baseAssetAddress);
            await mockRouter.waitForDeployment();
            routerAddress = await mockRouter.getAddress();
            console.log("✅ Mock Router deployed:", routerAddress);
        } else if (!initCodeHash) {
            throw new Error(
                "❌ INIT_CODE_HASH is required when using existing UNISWAP_V2_ROUTER\n" +
                "   Get it from your V2 factory: factory.INIT_CODE_PAIR_HASH()"
            );
        }
    } else if (isMainnet) {
        console.log("\n🌐 Mainnet Deployment");

        // Use real addresses from environment
        baseAssetAddress = process.env.BASE_ASSET_ADDRESS || "";
        routerAddress = process.env.UNISWAP_V2_ROUTER || "";
        initCodeHash = process.env.INIT_CODE_HASH || "";

        if (!baseAssetAddress || !routerAddress || !initCodeHash) {
            throw new Error(
                "❌ Missing required environment variables:\n" +
                `   BASE_ASSET_ADDRESS: ${baseAssetAddress ? '✓' : '✗'}\n` +
                `   UNISWAP_V2_ROUTER: ${routerAddress ? '✓' : '✗'}\n` +
                `   INIT_CODE_HASH: ${initCodeHash ? '✓' : '✗'}\n` +
                "\n   INIT_CODE_HASH: Get from your V2 factory via factory.INIT_CODE_PAIR_HASH()"
            );
        }

        console.log("Base Asset (JUSD) Address:", baseAssetAddress);
        console.log("JuiceSwap V2 Router:", routerAddress);
        console.log("Init Code Hash:", initCodeHash);
    } else {
        // Local hardhat network (no fork)
        console.log("\n🏠 Local Network Deployment (deploying mock contracts)");
        console.log("⚠️  To use real contracts, set FORK_CITREA=true and configure .env");
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const baseAsset = await MockERC20.deploy("Wrapped cBTC", "WcBTC");
        await baseAsset.waitForDeployment();
        baseAssetAddress = await baseAsset.getAddress();

        // Deploy mock factory first (for init code hash)
        const MockFactory = await ethers.getContractFactory("MockUniswapV2Factory");
        const mockFactory = await MockFactory.deploy();
        await mockFactory.waitForDeployment();
        const factoryAddr = await mockFactory.getAddress();

        // Get init code hash from factory
        initCodeHash = await mockFactory.INIT_CODE_PAIR_HASH();

        // Deploy mock router with factory
        const MockRouter = await ethers.getContractFactory("MockUniswapV2Router");
        const mockRouter = await MockRouter.deploy(factoryAddr, baseAssetAddress);
        await mockRouter.waitForDeployment();
        routerAddress = await mockRouter.getAddress();

        console.log("✅ Mock WcBTC:", baseAssetAddress);
        console.log("✅ Mock Factory:", factoryAddr);
        console.log("✅ Mock Router:", routerAddress);
        console.log("✅ Init Code Hash:", initCodeHash);
    }

    // Query base asset decimals and calculate initial virtual base reserves
    console.log("\n🔍 Checking Base Asset...");
    try {
        const baseAssetContract = await ethers.getContractAt(
            ["function decimals() view returns (uint8)", "function name() view returns (string)"],
            baseAssetAddress
        );
        decimals = Number(await baseAssetContract.decimals());
        const baseAssetName = await baseAssetContract.name();
        console.log(`   Name: ${baseAssetName}`);
        console.log(`   Decimals: ${decimals}`);
    } catch (e) {
        console.log("   Could not fetch decimals, assuming 18");
        decimals = 18;
    }

    // Calculate initial virtual base reserves with correct decimals
    const targetValue = process.env.INITIAL_VIRTUAL_BASE || "4500";
    initialVirtualBaseReserves = ethers.parseUnits(targetValue, decimals);

    // Validate parameter
    if (initialVirtualBaseReserves === 0n) {
        throw new Error("❌ INITIAL_VIRTUAL_BASE must be greater than 0");
    }

    console.log(`   Initial Virtual Base Reserves: ${ethers.formatUnits(initialVirtualBaseReserves, decimals)} (${decimals} decimals)`);

    // Calculate and display expected economics at graduation
    const initialBase = Number(targetValue);
    const jusdCollected = initialBase * 2.8335;  // Amount collected when curve completes
    const marketCapAtGrad = initialBase * 13.7;  // Market cap at graduation
    const totalLiquidity = initialBase * 5.667;  // Total V2 liquidity (2x JUSD side)

    console.log("\n💰 Expected Economics at Graduation:");
    console.log(`   Base Collected: ~${jusdCollected.toFixed(2)}`);
    console.log(`   Market Cap: ~$${marketCapAtGrad.toFixed(2)}`);
    console.log(`   V2 Liquidity: ~$${totalLiquidity.toFixed(2)} (${((totalLiquidity / marketCapAtGrad) * 100).toFixed(1)}% of MC)`);
    console.log(`   Price Multiplier: 14.7x (from start to graduation)`);

    // Deploy BondingCurveToken implementation
    console.log("\n📄 Deploying BondingCurveToken implementation...");
    const BondingCurveToken = await ethers.getContractFactory("BondingCurveToken");
    const implementation = await BondingCurveToken.deploy();
    await implementation.waitForDeployment();
    const implementationAddress = await implementation.getAddress();
    console.log("✅ Implementation deployed:", implementationAddress);

    // Deploy TokenFactory
    console.log("\n🏭 Deploying TokenFactory...");
    const TokenFactory = await ethers.getContractFactory("TokenFactory");
    const factory = await TokenFactory.deploy(
        implementationAddress,
        routerAddress,
        baseAssetAddress,
        feeRecipient,
        initialVirtualBaseReserves,
        initCodeHash
    );
    await factory.waitForDeployment();
    const factoryAddress = await factory.getAddress();
    console.log("✅ TokenFactory deployed:", factoryAddress);
    console.log("   Base Asset:", baseAssetAddress);
    console.log("   Fee Recipient:", feeRecipient);
    console.log("   Initial Virtual Base:", ethers.formatUnits(initialVirtualBaseReserves, decimals));
    console.log("   Init Code Hash:", initCodeHash);

    // Create deployment summary
    const deployment = {
        network: networkName,
        chainId: (await ethers.provider.getNetwork()).chainId.toString(),
        timestamp: new Date().toISOString(),
        deployer: deployer.address,
        contracts: {
            baseAsset: baseAssetAddress,
            implementation: implementationAddress,
            factory: factoryAddress,
            router: routerAddress,
            feeRecipient: feeRecipient,
            initCodeHash: initCodeHash,
        },
        constants: {
            totalSupply: "1000000000000000000000000000", // 1B with 18 decimals
            virtualTokenReserves: "1073000000000000000000000000", // 1.073B
            initialVirtualBaseReserves: initialVirtualBaseReserves.toString(),
            baseAssetDecimals: decimals,
            realTokenReserves: "793100000000000000000000000", // 793.1M
            reservedForDex: "206900000000000000000000000", // 206.9M
            feeBps: "100", // 1%
            note: "Initial virtual base reserves is configurable via factory.setInitialVirtualBaseReserves()",
        },
        economicsAtGraduation: {
            baseCollected: `~${jusdCollected.toFixed(2)}`,
            marketCapUSD: `~$${marketCapAtGrad.toFixed(2)}`,
            totalLiquidityUSD: `~$${totalLiquidity.toFixed(2)}`,
            liquidityToMarketCapRatio: "~41.37%",
            priceMultiplier: "~14.7x",
            note: "These values are derived from initialVirtualBaseReserves using constant product formula (x*y=k)",
        },
    };

    // Print deployment summary
    console.log("\n" + "=".repeat(70));
    console.log("📋 DEPLOYMENT SUMMARY");
    console.log("=".repeat(70));
    console.log(JSON.stringify(deployment, null, 2));
    console.log("=".repeat(70));

    // Save deployment to file
    const deploymentsDir = path.join(process.cwd(), "deployments");
    if (!fs.existsSync(deploymentsDir)) {
        fs.mkdirSync(deploymentsDir);
    }

    const filename = `${networkName}-${Date.now()}.json`;
    const filepath = path.join(deploymentsDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(deployment, null, 2));
    console.log(`\n💾 Deployment saved to: ${filepath}\n`);

    // Print next steps
    console.log("📝 NEXT STEPS:\n");
    if (isTestnet) {
        console.log("1. Verify contracts (see commands below)");
        console.log("2. Create a test token:");
        console.log(`   factory.createToken("Test Token", "TEST", "ipfs://QmMetadataHash...")`);
        console.log(`   (All tokens will trade against: ${baseAssetAddress})`);
        console.log("3. Test buying/selling on the bonding curve");
        console.log("4. Test graduation to V2");
    } else if (isMainnet) {
        console.log("⚠️  MAINNET DEPLOYMENT - VERIFY EVERYTHING!");
        console.log("1. Verify contracts (see commands below)");
        console.log("2. Run security checks");
        console.log("3. Test with small amounts first");
        console.log("4. Monitor first few token launches closely");
        console.log("5. Transfer ownership via deploy-governance.ts when ready");
    } else {
        console.log("1. Run tests: npm test");
        console.log("2. Check coverage: npm run test:coverage");
        console.log("3. Deploy to testnet when ready");
    }

    // Print verification commands for non-local networks
    if (isTestnet || isMainnet) {
        console.log("\n🔍 VERIFICATION COMMANDS:\n");
        console.log(`npx hardhat verify --network ${networkName} ${implementationAddress}\n`);
        console.log(`npx hardhat verify --network ${networkName} ${factoryAddress} "${implementationAddress}" "${routerAddress}" "${baseAssetAddress}" "${feeRecipient}" "${initialVirtualBaseReserves}" "${initCodeHash}"\n`);
    }

    console.log("");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
