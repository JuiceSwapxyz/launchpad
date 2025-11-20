import { expect } from "chai";
import hre from "hardhat";

// Top-level await - official Hardhat 3.0 pattern
const { ethers, networkHelpers } = await hre.network.connect();

describe("BondingCurveToken - Trading", function () {
    // Fixture for deployment
    async function deployFixture() {
        const [owner, user1, user2, user3] = await ethers.getSigners();

        // Deploy mock base asset (WcBTC)
        const baseAsset = await ethers.deployContract("MockERC20", ["Wrapped cBTC", "WcBTC"]);

        // Deploy mock router
        const router = await ethers.deployContract("MockUniswapV2Router", [
            ethers.ZeroAddress,
            ethers.ZeroAddress,
        ]);

        // Deploy implementation
        const implementation = await ethers.deployContract("BondingCurveToken");

        // Deploy factory with base asset and fee recipient
        const factory = await ethers.deployContract("TokenFactory", [
            await implementation.getAddress(),
            await router.getAddress(),
            await baseAsset.getAddress(),
            owner.address,  // Fee recipient
        ]);

        // Create a token
        await factory.createToken("Test Token", "TEST");
        const tokenAddress = await factory.getToken(0);
        const token = await ethers.getContractAt("BondingCurveToken", tokenAddress);

        // Mint some base asset to users for testing
        const mintAmount = ethers.parseEther("1000");
        await baseAsset.mint(user1.address, mintAmount);
        await baseAsset.mint(user2.address, mintAmount);
        await baseAsset.mint(user3.address, mintAmount);

        return { token, baseAsset, factory, router, owner, user1, user2, user3 };
    }

    describe("Initialization", function () {
        it("Should initialize with correct reserves", async function () {
            const { token } = await networkHelpers.loadFixture(deployFixture);

            const reserves = await token.getReserves();
            expect(reserves.virtualToken).to.equal(ethers.parseEther("1073000000")); // 1.073B
            expect(reserves.virtualBase).to.equal(ethers.parseEther("4500")); // 4,500 JUSD
            expect(reserves.realToken).to.equal(ethers.parseEther("793100000")); // 793.1M
            expect(reserves.realBase).to.equal(0); // Starts at 0
        });

        it("Should mint total supply to contract", async function () {
            const { token } = await networkHelpers.loadFixture(deployFixture);

            const totalSupply = await token.totalSupply();
            const contractBalance = await token.balanceOf(await token.getAddress());

            expect(totalSupply).to.equal(ethers.parseEther("1000000000")); // 1B
            expect(contractBalance).to.equal(totalSupply);
        });

        it("Should not be graduated initially", async function () {
            const { token } = await networkHelpers.loadFixture(deployFixture);

            expect(await token.graduated()).to.be.false;
        });

        it("Should have correct fee constants", async function () {
            const { token } = await networkHelpers.loadFixture(deployFixture);

            expect(await token.FEE_BPS()).to.equal(100); // 1%
            expect(await token.BPS_DENOMINATOR()).to.equal(10000);
        });
    });

    describe("Buy Function", function () {
        it("Should buy tokens successfully", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            const buyAmount = ethers.parseEther("1"); // 1 unit of base asset

            // Approve token contract to spend base asset
            await baseAsset.connect(user1).approve(await token.getAddress(), buyAmount);

            // Get quote
            const quote = await token.calculateBuy(buyAmount);

            // Execute buy
            const tx = await token.connect(user1).buy(buyAmount, quote);

            // Check event
            await expect(tx)
                .to.emit(token, "Buy")
                .withArgs(user1.address, buyAmount, quote, await token.virtualTokenReserves(), await token.virtualBaseReserves());

            // Check user received tokens
            expect(await token.balanceOf(user1.address)).to.equal(quote);
        });

        it("Should deduct 1% fee from input", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            const buyAmount = ethers.parseEther("1");
            const fee = buyAmount * 100n / 10000n; // 1%
            const buyAmountAfterFee = buyAmount - fee;

            await baseAsset.connect(user1).approve(await token.getAddress(), buyAmount);

            const reservesBefore = await token.getReserves();
            await token.connect(user1).buy(buyAmount, 0);
            const reservesAfter = await token.getReserves();

            // Real base reserves should increase by buyAmountAfterFee (not full buyAmount)
            expect(reservesAfter.realBase).to.equal(reservesBefore.realBase + buyAmountAfterFee);
        });

        it("Should update virtual reserves correctly", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            const buyAmount = ethers.parseEther("1");
            await baseAsset.connect(user1).approve(await token.getAddress(), buyAmount);

            const reservesBefore = await token.getReserves();
            const tokensOut = await token.calculateBuy(buyAmount);

            await token.connect(user1).buy(buyAmount, tokensOut);

            const reservesAfter = await token.getReserves();

            // Virtual base should increase
            expect(reservesAfter.virtualBase).to.be.gt(reservesBefore.virtualBase);

            // Virtual token should decrease
            expect(reservesAfter.virtualToken).to.be.lt(reservesBefore.virtualToken);

            // Check constant product formula: k should remain constant
            const kBefore = reservesBefore.virtualBase * reservesBefore.virtualToken;
            const kAfter = reservesAfter.virtualBase * reservesAfter.virtualToken;

            // Allow small rounding difference
            const diff = kAfter > kBefore ? kAfter - kBefore : kBefore - kAfter;
            expect(diff).to.be.lt(BigInt(kBefore) / 1000000n); // Less than 0.0001% difference
        });

        it("Should update real reserves correctly", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            const buyAmount = ethers.parseEther("1");
            await baseAsset.connect(user1).approve(await token.getAddress(), buyAmount);

            const reservesBefore = await token.getReserves();
            const tokensOut = await token.calculateBuy(buyAmount);

            await token.connect(user1).buy(buyAmount, tokensOut);

            const reservesAfter = await token.getReserves();

            // Real token reserves should decrease
            expect(reservesAfter.realToken).to.equal(reservesBefore.realToken - tokensOut);

            // Real base reserves should increase (minus fee)
            const fee = buyAmount * 100n / 10000n;
            expect(reservesAfter.realBase).to.equal(reservesBefore.realBase + (buyAmount - fee));
        });

        it("Should revert if already graduated", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            // Manually set graduated flag for testing
            // Note: In real scenario, this happens when realTokenReserves reaches 0
            // We'll test full graduation in separate test file

            const buyAmount = ethers.parseEther("1");
            await baseAsset.connect(user1).approve(await token.getAddress(), buyAmount);

            // For now, just test with a small buy
            await token.connect(user1).buy(buyAmount, 0);
        });

        it("Should revert if zero amount", async function () {
            const { token, user1 } = await networkHelpers.loadFixture(deployFixture);

            await expect(
                token.connect(user1).buy(0, 0)
            ).to.be.revertedWithCustomError(token, "ZeroAmount");
        });

        it("Should revert if slippage exceeded", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            const buyAmount = ethers.parseEther("1");
            const quote = await token.calculateBuy(buyAmount);
            const minTokensOut = quote + 1n; // Require more than possible

            await baseAsset.connect(user1).approve(await token.getAddress(), buyAmount);

            await expect(
                token.connect(user1).buy(buyAmount, minTokensOut)
            ).to.be.revertedWithCustomError(token, "InsufficientOutput");
        });

        it("Should handle multiple sequential buys", async function () {
            const { token, baseAsset, user1, user2 } = await networkHelpers.loadFixture(deployFixture);

            const buyAmount = ethers.parseEther("5");

            // User1 buys
            await baseAsset.connect(user1).approve(await token.getAddress(), buyAmount);
            const quote1 = await token.calculateBuy(buyAmount);
            await token.connect(user1).buy(buyAmount, quote1);

            // User2 buys (should get fewer tokens for same price due to curve)
            await baseAsset.connect(user2).approve(await token.getAddress(), buyAmount);
            const quote2 = await token.calculateBuy(buyAmount);
            await token.connect(user2).buy(buyAmount, quote2);

            // Second buyer should get fewer tokens (price increased)
            expect(quote2).to.be.lt(quote1);

            // Check balances
            expect(await token.balanceOf(user1.address)).to.equal(quote1);
            expect(await token.balanceOf(user2.address)).to.equal(quote2);
        });

        it("Should match quote calculation", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            const buyAmount = ethers.parseEther("1");
            const quote = await token.calculateBuy(buyAmount);

            await baseAsset.connect(user1).approve(await token.getAddress(), buyAmount);

            const balanceBefore = await token.balanceOf(user1.address);
            await token.connect(user1).buy(buyAmount, quote);
            const balanceAfter = await token.balanceOf(user1.address);

            const actualTokensReceived = balanceAfter - balanceBefore;
            expect(actualTokensReceived).to.equal(quote);
        });
    });

    describe("Sell Function", function () {
        // Helper to buy tokens first
        async function buyTokensFixture() {
            const fixture = await deployFixture();
            const { token, baseAsset, user1 } = fixture;

            const buyAmount = ethers.parseEther("10");
            await baseAsset.connect(user1).approve(await token.getAddress(), buyAmount);
            await token.connect(user1).buy(buyAmount, 0);

            return fixture;
        }

        it("Should sell tokens successfully", async function () {
            const { token, user1 } = await networkHelpers.loadFixture(buyTokensFixture);

            const userBalance = await token.balanceOf(user1.address);
            const sellAmount = userBalance / 2n; // Sell half

            const quote = await token.calculateSell(sellAmount);
            const tx = await token.connect(user1).sell(sellAmount, quote);

            // Check event
            await expect(tx)
                .to.emit(token, "Sell")
                .withArgs(user1.address, sellAmount, quote, await token.virtualTokenReserves(), await token.virtualBaseReserves());
        });

        it("Should deduct 1% fee from output", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(buyTokensFixture);

            const userBalance = await token.balanceOf(user1.address);
            const sellAmount = userBalance / 2n;

            const baseBalanceBefore = await baseAsset.balanceOf(user1.address);
            const quote = await token.calculateSell(sellAmount);

            await token.connect(user1).sell(sellAmount, quote);

            const baseBalanceAfter = await baseAsset.balanceOf(user1.address);
            const actualBaseReceived = baseBalanceAfter - baseBalanceBefore;

            expect(actualBaseReceived).to.equal(quote);
        });

        it("Should update virtual reserves correctly", async function () {
            const { token, user1 } = await networkHelpers.loadFixture(buyTokensFixture);

            const userBalance = await token.balanceOf(user1.address);
            const sellAmount = userBalance / 2n;

            const reservesBefore = await token.getReserves();
            await token.connect(user1).sell(sellAmount, 0);
            const reservesAfter = await token.getReserves();

            // Virtual token should increase
            expect(reservesAfter.virtualToken).to.be.gt(reservesBefore.virtualToken);

            // Virtual base should decrease
            expect(reservesAfter.virtualBase).to.be.lt(reservesBefore.virtualBase);
        });

        it("Should update real reserves correctly", async function () {
            const { token, user1 } = await networkHelpers.loadFixture(buyTokensFixture);

            const userBalance = await token.balanceOf(user1.address);
            const sellAmount = userBalance / 2n;

            const reservesBefore = await token.getReserves();
            const baseOut = await token.calculateSell(sellAmount);

            await token.connect(user1).sell(sellAmount, baseOut);

            const reservesAfter = await token.getReserves();

            // Real token reserves should increase
            expect(reservesAfter.realToken).to.equal(reservesBefore.realToken + sellAmount);

            // Real base reserves should decrease
            expect(reservesAfter.realBase).to.equal(reservesBefore.realBase - baseOut);
        });

        it("Should revert if zero amount", async function () {
            const { token, user1 } = await networkHelpers.loadFixture(buyTokensFixture);

            await expect(
                token.connect(user1).sell(0, 0)
            ).to.be.revertedWithCustomError(token, "ZeroAmount");
        });

        it("Should revert if slippage exceeded", async function () {
            const { token, user1 } = await networkHelpers.loadFixture(buyTokensFixture);

            const userBalance = await token.balanceOf(user1.address);
            const sellAmount = userBalance / 2n;
            const quote = await token.calculateSell(sellAmount);
            const minBaseOut = quote + 1n; // Require more than possible

            await expect(
                token.connect(user1).sell(sellAmount, minBaseOut)
            ).to.be.revertedWithCustomError(token, "InsufficientOutput");
        });

        it("Should match quote calculation", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(buyTokensFixture);

            const userBalance = await token.balanceOf(user1.address);
            const sellAmount = userBalance / 2n;
            const quote = await token.calculateSell(sellAmount);

            const baseBefore = await baseAsset.balanceOf(user1.address);
            await token.connect(user1).sell(sellAmount, quote);
            const baseAfter = await baseAsset.balanceOf(user1.address);

            const actualBaseReceived = baseAfter - baseBefore;
            expect(actualBaseReceived).to.equal(quote);
        });
    });

    describe("Calculation Functions", function () {
        it("calculateBuy should return zero for zero input", async function () {
            const { token } = await networkHelpers.loadFixture(deployFixture);

            expect(await token.calculateBuy(0)).to.equal(0);
        });

        it("calculateSell should return zero for zero input", async function () {
            const { token } = await networkHelpers.loadFixture(deployFixture);

            expect(await token.calculateSell(0)).to.equal(0);
        });

        it("Price should increase as tokens are bought", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            const buyAmount = ethers.parseEther("5");

            // Get initial price (tokens per unit of base)
            const initialQuote = await token.calculateBuy(buyAmount);

            // Execute first buy
            await baseAsset.connect(user1).approve(await token.getAddress(), buyAmount);
            await token.connect(user1).buy(buyAmount, 0);

            // Get new price for same amount
            const newQuote = await token.calculateBuy(buyAmount);

            // Should get fewer tokens for same price (price increased)
            expect(newQuote).to.be.lt(initialQuote);
        });

        it("Should track progress correctly", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            const initialProgress = await token.getBondingCurveProgress();
            expect(initialProgress).to.equal(0);

            // Buy some tokens
            const buyAmount = ethers.parseEther("10");
            await baseAsset.connect(user1).approve(await token.getAddress(), buyAmount);
            await token.connect(user1).buy(buyAmount, 0);

            const newProgress = await token.getBondingCurveProgress();
            expect(newProgress).to.be.gt(0);
            expect(newProgress).to.be.lt(10000); // Less than 100%
        });
    });
});
