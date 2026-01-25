import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { ADDRESS as JUSD_ADDRESS } from "@juicedollar/jusd";
import { V2_FACTORY_ADDRESSES, V2_ROUTER_ADDRESSES, V2_INIT_CODE_HASH } from "@juiceswapxyz/sdk-core";

const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));

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
    const isFork = networkName === "forkTestnet" || networkName === "forkMainnet";

    // Map network name to chain ID
    const NETWORK_TO_CHAIN_ID: Record<string, number> = {
        citreaTestnet: 5115,  // ChainId.CITREA_TESTNET
        citreaMainnet: 4114,  // ChainId.CITREA_MAINNET
    };

    const chainId = isFork
        ? Number((await ethers.provider.getNetwork()).chainId)
        : NETWORK_TO_CHAIN_ID[networkName];
    if (!chainId && (isTestnet || isMainnet)) {
        throw new Error(`Unknown network: ${networkName}`);
    }

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
        const forkTarget = networkName === "forkMainnet" ? "mainnet" : "testnet";
        console.log(isFork ? `\n🍴 Fork Deployment (using real ${forkTarget} contracts)` : "\n📝 Testnet Deployment");

        // Get addresses from packages (single source of truth)
        const jusdAddresses = JUSD_ADDRESS[chainId];
        if (!jusdAddresses) {
            throw new Error(
                `❌ Chain ${chainId} not supported by @juicedollar/jusd.\n` +
                `   Supported chains: ${Object.keys(JUSD_ADDRESS).join(", ")}`
            );
        }

        if (!jusdAddresses.juiceDollar || jusdAddresses.juiceDollar === "0x0000000000000000000000000000000000000000") {
            throw new Error(
                `❌ JUSD not deployed on chain ${chainId}.\n` +
                `   Deploy JuiceDollar first and update @juicedollar/jusd package`
            );
        }

        const v2FactoryAddress = V2_FACTORY_ADDRESSES[chainId];
        const v2RouterAddress = V2_ROUTER_ADDRESSES[chainId];

        if (!v2RouterAddress || v2RouterAddress === "0x0000000000000000000000000000000000000000") {
            throw new Error(
                `❌ V2 Router not deployed on chain ${chainId}.\n` +
                `   Deploy DEX first using deploy-v3/scripts/deploy.ts`
            );
        }

        baseAssetAddress = jusdAddresses.juiceDollar;
        routerAddress = v2RouterAddress;

        // Get init code hash from sdk-core (matches v2-periphery/UniswapV2Library.sol)
        initCodeHash = V2_INIT_CODE_HASH;

        console.log("📦 Addresses from packages (single source of truth):");
        console.log(`   JUSD:           ${baseAssetAddress} (from @juicedollar/jusd)`);
        console.log(`   V2 Router:      ${routerAddress} (from @juiceswapxyz/sdk-core)`);
        console.log(`   V2 Factory:     ${v2FactoryAddress} (from @juiceswapxyz/sdk-core)`);
        console.log(`   Init Code Hash: ${initCodeHash} (from @juiceswapxyz/sdk-core)`);
    } else if (isMainnet) {
        console.log("\n🌐 Mainnet Deployment");

        // Get addresses from packages (single source of truth)
        const jusdAddresses = JUSD_ADDRESS[chainId];
        if (!jusdAddresses) {
            throw new Error(
                `❌ Chain ${chainId} not supported by @juicedollar/jusd.\n` +
                `   Supported chains: ${Object.keys(JUSD_ADDRESS).join(", ")}`
            );
        }

        if (!jusdAddresses.juiceDollar || jusdAddresses.juiceDollar === "0x0000000000000000000000000000000000000000") {
            throw new Error(
                `❌ JUSD not deployed on chain ${chainId}.\n` +
                `   Deploy JuiceDollar first and update @juicedollar/jusd package`
            );
        }

        const v2FactoryAddress = V2_FACTORY_ADDRESSES[chainId];
        const v2RouterAddress = V2_ROUTER_ADDRESSES[chainId];

        if (!v2RouterAddress || v2RouterAddress === "0x0000000000000000000000000000000000000000") {
            throw new Error(
                `❌ V2 Router not deployed on chain ${chainId}.\n` +
                `   Deploy DEX first using deploy-v3/scripts/deploy.ts`
            );
        }

        baseAssetAddress = jusdAddresses.juiceDollar;
        routerAddress = v2RouterAddress;

        // Get init code hash from sdk-core (matches v2-periphery/UniswapV2Library.sol)
        initCodeHash = V2_INIT_CODE_HASH;

        console.log("📦 Addresses from packages (single source of truth):");
        console.log(`   JUSD:           ${baseAssetAddress} (from @juicedollar/jusd)`);
        console.log(`   V2 Router:      ${routerAddress} (from @juiceswapxyz/sdk-core)`);
        console.log(`   V2 Factory:     ${v2FactoryAddress} (from @juiceswapxyz/sdk-core)`);
        console.log(`   Init Code Hash: ${initCodeHash} (from @juiceswapxyz/sdk-core)`);
    } else {
        // Local hardhat network (no fork)
        console.log("\n🏠 Local Network Deployment (deploying mock contracts)");
        console.log("⚠️  To use real contracts, use --network forkTestnet or --network forkMainnet");
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

    // Create deployment summary (matches smart-contracts pattern for verification)
    const deployment = {
        schemaVersion: "1.0",
        network: {
            name: networkName,
            chainId: Number((await ethers.provider.getNetwork()).chainId),
        },
        deployment: {
            deployedAt: new Date().toISOString(),
            deployedBy: deployer.address,
            blockNumber: await ethers.provider.getBlockNumber(),
        },
        contracts: {
            BondingCurveToken: {
                address: implementationAddress,
                constructorArgs: [], // No constructor args (implementation)
            },
            TokenFactory: {
                address: factoryAddress,
                constructorArgs: [
                    implementationAddress,
                    routerAddress,
                    baseAssetAddress,
                    feeRecipient,
                    initialVirtualBaseReserves.toString(),
                    initCodeHash,
                ],
            },
        },
        references: {
            baseAsset: baseAssetAddress,
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
        metadata: {
            deployer: "JuiceSwapXyz/launchpad",
            scriptVersion: packageJson.version,
        },
    };

    // Print deployment summary
    console.log("\n" + "=".repeat(70));
    console.log("📋 DEPLOYMENT SUMMARY");
    console.log("=".repeat(70));
    console.log(JSON.stringify(deployment, null, 2));
    console.log("=".repeat(70));

    // Save deployment to file (single file per network, matches deploy-v3 pattern)
    const deploymentsDir = path.join(process.cwd(), "deployments");
    const networkDir = path.join(deploymentsDir, networkName);
    if (!fs.existsSync(networkDir)) {
        fs.mkdirSync(networkDir, { recursive: true });
    }

    const filepath = path.join(networkDir, "launchpad.json");
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
