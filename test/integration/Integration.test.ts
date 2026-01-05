import { expect } from "chai";
import {
    isForkMode,
    isTestnet,
    getEnvOrThrow,
    getTestSigner,
    deployFactory,
    DEAD_ADDRESS,
    formatTokens,
    log,
    ethers, // Use same connection as helpers
} from "./helpers.js";

// Contract interfaces
const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)",
    "function transfer(address, uint256) returns (bool)",
    "function allowance(address, address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
];

const V2_ROUTER_ABI = [
    "function factory() view returns (address)",
    "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])",
    "function getAmountsOut(uint256, address[]) view returns (uint256[])",
];

const V2_FACTORY_ABI = [
    "function getPair(address, address) view returns (address)",
    "function INIT_CODE_PAIR_HASH() view returns (bytes32)",
];

const V2_PAIR_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function getReserves() view returns (uint112, uint112, uint32)",
];

describe("Launchpad Integration Tests", function () {
    // Increase timeout for network calls
    this.timeout(120000);

    // Shared state
    let factoryAddress: string;
    let baseAssetAddress: string;
    let routerAddress: string;
    let factory: any;
    let baseAsset: any;
    let router: any;
    let testSigner: any;
    let testToken: any;
    let testTokenAddress: string;

    before(async function () {
        // Validate environment
        const mode = isForkMode() ? "FORK" : isTestnet() ? "TESTNET" : "LOCAL";
        log(`Running in ${mode} mode`);

        if (!isForkMode() && !isTestnet()) {
            this.skip();
            return;
        }

        // Load required addresses
        baseAssetAddress = getEnvOrThrow("BASE_ASSET_ADDRESS");
        routerAddress = getEnvOrThrow("UNISWAP_V2_ROUTER");

        if (isForkMode()) {
            // Deploy contracts fresh in this fork instance
            log("Deploying contracts to fork...");
            factory = await deployFactory();
            factoryAddress = await factory.getAddress();
            log(`Factory deployed: ${factoryAddress}`);
        } else {
            // Testnet: use existing deployment
            factoryAddress = getEnvOrThrow("FACTORY_ADDRESS");
            factory = await ethers.getContractAt("TokenFactory", factoryAddress);
            log(`Factory: ${factoryAddress}`);
        }

        log(`Base Asset (JUSD): ${baseAssetAddress}`);
        log(`V2 Router: ${routerAddress}`);

        // Connect to contracts
        baseAsset = new ethers.Contract(baseAssetAddress, ERC20_ABI, ethers.provider);
        router = new ethers.Contract(routerAddress, V2_ROUTER_ABI, ethers.provider);

        // Get test signer (whale on fork, deployer on testnet)
        testSigner = await getTestSigner();
        const signerAddress = await testSigner.getAddress();
        log(`Test signer: ${signerAddress}`);

        // Check JUSD balance
        const jusdBalance = await baseAsset.balanceOf(signerAddress);
        log(`JUSD balance: ${formatTokens(jusdBalance)}`);

        if (jusdBalance === 0n) {
            throw new Error("Test signer has no JUSD balance");
        }
    });

    describe("1. Deployment Verification", function () {
        it("Should have correct base asset configured", async function () {
            const configuredBaseAsset = await factory.baseAsset();
            expect(configuredBaseAsset.toLowerCase()).to.equal(baseAssetAddress.toLowerCase());
        });

        it("Should have correct router configured", async function () {
            const configuredRouter = await factory.uniswapV2Router();
            expect(configuredRouter.toLowerCase()).to.equal(routerAddress.toLowerCase());
        });

        it("Should have valid implementation address", async function () {
            const implementation = await factory.implementation();
            expect(implementation).to.not.equal(ethers.ZeroAddress);
            log(`Implementation: ${implementation}`);
        });

        it("Should have correct init code hash", async function () {
            const initCodeHash = await factory.initCodeHash();
            const expectedHash = getEnvOrThrow("INIT_CODE_HASH");
            expect(initCodeHash.toLowerCase()).to.equal(expectedHash.toLowerCase());
        });

        it("Should have valid fee recipient", async function () {
            const feeRecipient = await factory.feeRecipient();
            expect(feeRecipient).to.not.equal(ethers.ZeroAddress);
            log(`Fee recipient: ${feeRecipient}`);
        });

        it("Should have correct initial virtual base reserves", async function () {
            const virtualBase = await factory.initialVirtualBaseReserves();
            expect(virtualBase).to.be.gt(0n);
            log(`Initial virtual base: ${formatTokens(virtualBase)} JUSD`);
        });
    });

    describe("2. Token Creation", function () {
        it("Should create a new token", async function () {
            const allTokensLengthBefore = await factory.allTokensLength();
            const tokenName = `Integration Test ${Date.now()}`;
            const tokenSymbol = `INT${allTokensLengthBefore}`;
            const metadataURI = `ipfs://QmIntegrationTest${allTokensLengthBefore}`;

            log(`Creating token: ${tokenName} (${tokenSymbol})`);

            const tx = await factory.connect(testSigner).createToken(tokenName, tokenSymbol, metadataURI);
            const receipt = await tx.wait();

            const allTokensLengthAfter = await factory.allTokensLength();
            expect(allTokensLengthAfter).to.equal(allTokensLengthBefore + 1n);

            // Get the created token
            testTokenAddress = await factory.getToken(allTokensLengthAfter - 1n);
            testToken = await ethers.getContractAt("BondingCurveToken", testTokenAddress);

            // Verify metadata was stored correctly
            const info = await factory.getTokenInfo(testTokenAddress);
            expect(info.name).to.equal(tokenName);
            expect(info.symbol).to.equal(tokenSymbol);
            expect(info.metadataURI).to.equal(metadataURI);
            expect(info.creator).to.equal(testSigner.address);

            log(`Token created: ${testTokenAddress}`);
            log(`Metadata URI: ${metadataURI}`);
        });

        it("Should initialize token with correct reserves", async function () {
            const reserves = await testToken.getReserves();

            expect(reserves.virtualToken).to.equal(ethers.parseEther("1073000000")); // 1.073B
            expect(reserves.realToken).to.equal(ethers.parseEther("793100000")); // 793.1M
            expect(reserves.realBase).to.equal(0n); // No base collected yet

            log(`Virtual token reserves: ${formatTokens(reserves.virtualToken)}`);
            log(`Real token reserves: ${formatTokens(reserves.realToken)}`);
        });

        it("Should not be graduated initially", async function () {
            expect(await testToken.graduated()).to.be.false;
            expect(await testToken.canGraduate()).to.be.false;
        });

        it("Should have correct base asset and router", async function () {
            expect((await testToken.baseAsset()).toLowerCase()).to.equal(baseAssetAddress.toLowerCase());
            expect((await testToken.uniswapV2Router()).toLowerCase()).to.equal(routerAddress.toLowerCase());
        });
    });

    describe("3. Bonding Curve Trading", function () {
        const buyAmount = ethers.parseEther("10"); // 10 JUSD

        it("Should approve JUSD for token contract", async function () {
            const approveTx = await baseAsset.connect(testSigner).approve(testTokenAddress, ethers.MaxUint256);
            await approveTx.wait();

            const allowance = await baseAsset.allowance(await testSigner.getAddress(), testTokenAddress);
            expect(allowance).to.equal(ethers.MaxUint256);
        });

        it("Should buy tokens from bonding curve", async function () {
            const signerAddress = await testSigner.getAddress();
            const balanceBefore = await testToken.balanceOf(signerAddress);

            // Get quote
            const expectedTokens = await testToken.calculateBuy(buyAmount);
            log(`Buying with ${formatTokens(buyAmount)} JUSD, expecting ${formatTokens(expectedTokens)} tokens`);

            // Execute buy
            const tx = await testToken.connect(testSigner).buy(buyAmount, 0);
            await tx.wait();

            const balanceAfter = await testToken.balanceOf(signerAddress);
            expect(balanceAfter).to.be.gt(balanceBefore);

            log(`Tokens received: ${formatTokens(balanceAfter - balanceBefore)}`);
        });

        it("Should update reserves after buy", async function () {
            const reserves = await testToken.getReserves();

            expect(reserves.realBase).to.be.gt(0n);
            expect(reserves.realToken).to.be.lt(ethers.parseEther("793100000"));

            log(`Real base reserves: ${formatTokens(reserves.realBase)} JUSD`);
            log(`Real token reserves: ${formatTokens(reserves.realToken)}`);
        });

        it("Should sell tokens back to bonding curve", async function () {
            const signerAddress = await testSigner.getAddress();
            const tokenBalance = await testToken.balanceOf(signerAddress);
            const sellAmount = tokenBalance / 2n; // Sell half

            // Get quote
            const expectedBase = await testToken.calculateSell(sellAmount);
            log(`Selling ${formatTokens(sellAmount)} tokens, expecting ${formatTokens(expectedBase)} JUSD`);

            const jusdBefore = await baseAsset.balanceOf(signerAddress);

            // Execute sell
            const tx = await testToken.connect(testSigner).sell(sellAmount, 0);
            await tx.wait();

            const jusdAfter = await baseAsset.balanceOf(signerAddress);
            expect(jusdAfter).to.be.gt(jusdBefore);

            log(`JUSD received: ${formatTokens(jusdAfter - jusdBefore)}`);
        });
    });

    describe("4. Graduation to V2", function () {
        // This test requires significant JUSD to complete the bonding curve
        // Skip on testnet to conserve funds unless explicitly enabled
        before(function () {
            if (isTestnet() && !process.env.RUN_GRADUATION_TEST) {
                log("Skipping graduation test on testnet (set RUN_GRADUATION_TEST=true to enable)");
                this.skip();
            }
        });

        it("Should complete bonding curve with large purchase", async function () {
            // Buy enough to complete the curve (~12,750 JUSD needed)
            const targetAmount = ethers.parseEther("15000"); // Overshoot to ensure completion

            const signerAddress = await testSigner.getAddress();
            const jusdBalance = await baseAsset.balanceOf(signerAddress);

            if (jusdBalance < targetAmount) {
                log(`Insufficient JUSD (${formatTokens(jusdBalance)}), skipping graduation test`);
                this.skip();
                return;
            }

            // Keep buying until curve completes
            let canGraduate = await testToken.canGraduate();
            let totalSpent = 0n;

            while (!canGraduate && totalSpent < targetAmount) {
                const buySize = ethers.parseEther("1000");
                try {
                    const tx = await testToken.connect(testSigner).buy(buySize, 0);
                    await tx.wait();
                    totalSpent += buySize;
                } catch (e) {
                    // Curve might be complete, check status
                    break;
                }
                canGraduate = await testToken.canGraduate();
            }

            log(`Total spent: ${formatTokens(totalSpent)} JUSD`);
            expect(await testToken.canGraduate()).to.be.true;
        });

        it("Should graduate to V2", async function () {
            if (!(await testToken.canGraduate())) {
                this.skip();
                return;
            }

            log("Graduating token to V2...");

            const tx = await testToken.connect(testSigner).graduate();
            await tx.wait();

            expect(await testToken.graduated()).to.be.true;
            log("Token graduated successfully!");
        });

        it("Should have created V2 pair", async function () {
            if (!(await testToken.graduated())) {
                this.skip();
                return;
            }

            const v2Pair = await testToken.v2Pair();
            expect(v2Pair).to.not.equal(ethers.ZeroAddress);

            // Verify pair exists on factory
            const v2Factory = new ethers.Contract(await router.factory(), V2_FACTORY_ABI, ethers.provider);
            const factoryPair = await v2Factory.getPair(testTokenAddress, baseAssetAddress);
            expect(factoryPair.toLowerCase()).to.equal(v2Pair.toLowerCase());

            log(`V2 Pair: ${v2Pair}`);
        });

        it("Should have burned LP tokens", async function () {
            if (!(await testToken.graduated())) {
                this.skip();
                return;
            }

            const v2Pair = await testToken.v2Pair();
            const pair = new ethers.Contract(v2Pair, V2_PAIR_ABI, ethers.provider);

            const deadBalance = await pair.balanceOf(DEAD_ADDRESS);
            const totalSupply = await pair.totalSupply();

            // Most LP tokens should be burned (minus minimum liquidity)
            const burnedPercentage = (deadBalance * 100n) / totalSupply;
            expect(burnedPercentage).to.be.gte(99n); // At least 99% burned

            log(`LP tokens burned: ${burnedPercentage}%`);
        });
    });

    describe("5. Post-Graduation V2 Trading", function () {
        before(function () {
            // Only run if graduation completed
            if (!testToken) {
                this.skip();
            }
        });

        it("Should be able to swap on V2 after graduation", async function () {
            const graduated = await testToken.graduated();
            if (!graduated) {
                log("Token not graduated, skipping V2 trading test");
                this.skip();
                return;
            }

            const signerAddress = await testSigner.getAddress();
            const tokenBalance = await testToken.balanceOf(signerAddress);

            if (tokenBalance === 0n) {
                log("No tokens to swap, skipping");
                this.skip();
                return;
            }

            const swapAmount = tokenBalance / 10n; // Swap 10%

            // Approve router
            await testToken.connect(testSigner).approve(routerAddress, swapAmount);

            // Get quote
            const amounts = await router.getAmountsOut(swapAmount, [testTokenAddress, baseAssetAddress]);
            log(`Swapping ${formatTokens(swapAmount)} tokens for ~${formatTokens(amounts[1])} JUSD`);

            const jusdBefore = await baseAsset.balanceOf(signerAddress);

            // Execute swap
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const tx = await router.connect(testSigner).swapExactTokensForTokens(
                swapAmount,
                0, // Accept any amount
                [testTokenAddress, baseAssetAddress],
                signerAddress,
                deadline
            );
            await tx.wait();

            const jusdAfter = await baseAsset.balanceOf(signerAddress);
            expect(jusdAfter).to.be.gt(jusdBefore);

            log(`V2 swap successful! Received ${formatTokens(jusdAfter - jusdBefore)} JUSD`);
        });
    });
});
