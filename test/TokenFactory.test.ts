import { expect } from "chai";
import hre from "hardhat";

// Top-level await - official Hardhat 3.0 pattern
const { ethers, networkHelpers } = await hre.network.connect();

describe("TokenFactory", function () {
    // Fixture for deployment - much faster than redeploying each time
    async function deployFixture() {
        // Get signers
        const [owner, user1, user2] = await ethers.getSigners();

        // Deploy mock base asset (WcBTC)
        const baseAsset = await ethers.deployContract("MockERC20", ["Wrapped cBTC", "WcBTC"]);

        // Deploy mock router
        const router = await ethers.deployContract("MockUniswapV2Router", [
            ethers.ZeroAddress,
            ethers.ZeroAddress,
        ]);

        // Deploy implementation contract
        const implementation = await ethers.deployContract("BondingCurveToken");

        // Deploy factory with base asset and fee recipient
        const factory = await ethers.deployContract("TokenFactory", [
            await implementation.getAddress(),
            await router.getAddress(),
            await baseAsset.getAddress(),
            owner.address,  // Fee recipient set to owner for testing
        ]);

        return { factory, implementation, baseAsset, router, owner, user1, user2 };
    }

    describe("Deployment", function () {
        it("Should set the correct implementation address", async function () {
            const { factory, implementation } = await networkHelpers.loadFixture(deployFixture);
            expect(await factory.implementation()).to.equal(await implementation.getAddress());
        });

        it("Should set the correct router address", async function () {
            const { factory, router } = await networkHelpers.loadFixture(deployFixture);
            expect(await factory.uniswapV2Router()).to.equal(await router.getAddress());
        });

        it("Should set the correct owner", async function () {
            const { factory, owner } = await networkHelpers.loadFixture(deployFixture);
            expect(await factory.owner()).to.equal(owner.address);
        });

        it("Should set the correct base asset", async function () {
            const { factory, baseAsset } = await networkHelpers.loadFixture(deployFixture);
            expect(await factory.baseAsset()).to.equal(await baseAsset.getAddress());
        });

        it("Should start with zero tokens", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);
            expect(await factory.allTokensLength()).to.equal(0);
        });

        it("Should revert if implementation is zero address", async function () {
            const { router, baseAsset, owner } = await networkHelpers.loadFixture(deployFixture);
            await expect(
                ethers.deployContract("TokenFactory", [
                    ethers.ZeroAddress,
                    await router.getAddress(),
                    await baseAsset.getAddress(),
                    owner.address,
                ])
            ).to.be.revertedWithCustomError(
                await ethers.getContractFactory("TokenFactory"),
                "InvalidImplementation"
            );
        });

        it("Should revert if router is zero address", async function () {
            const { implementation, baseAsset, owner } = await networkHelpers.loadFixture(deployFixture);
            await expect(
                ethers.deployContract("TokenFactory", [
                    await implementation.getAddress(),
                    ethers.ZeroAddress,
                    await baseAsset.getAddress(),
                    owner.address,
                ])
            ).to.be.revertedWithCustomError(
                await ethers.getContractFactory("TokenFactory"),
                "InvalidRouter"
            );
        });

        it("Should revert if base asset is zero address", async function () {
            const { implementation, router, owner } = await networkHelpers.loadFixture(deployFixture);
            await expect(
                ethers.deployContract("TokenFactory", [
                    await implementation.getAddress(),
                    await router.getAddress(),
                    ethers.ZeroAddress,
                    owner.address,
                ])
            ).to.be.revertedWithCustomError(
                await ethers.getContractFactory("TokenFactory"),
                "InvalidBaseAsset"
            );
        });

        it("Should set the correct fee recipient", async function () {
            const { factory, owner } = await networkHelpers.loadFixture(deployFixture);
            expect(await factory.feeRecipient()).to.equal(owner.address);
        });

        it("Should revert if fee recipient is zero address", async function () {
            const { implementation, router, baseAsset } = await networkHelpers.loadFixture(deployFixture);
            await expect(
                ethers.deployContract("TokenFactory", [
                    await implementation.getAddress(),
                    await router.getAddress(),
                    await baseAsset.getAddress(),
                    ethers.ZeroAddress,
                ])
            ).to.be.revertedWithCustomError(
                await ethers.getContractFactory("TokenFactory"),
                "InvalidFeeRecipient"
            );
        });
    });

    describe("Token Creation", function () {
        it("Should create a new token successfully", async function () {
            const { factory, owner, baseAsset } = await networkHelpers.loadFixture(deployFixture);

            const tx = await factory.createToken("Test Token", "TEST");

            await expect(tx)
                .to.emit(factory, "TokenCreated")
                .withArgs(
                    await factory.getToken(0),
                    owner.address,
                    "Test Token",
                    "TEST",
                    await baseAsset.getAddress()
                );

            expect(await factory.allTokensLength()).to.equal(1);
        });

        it("Should properly initialize the created token", async function () {
            const { factory, baseAsset } = await networkHelpers.loadFixture(deployFixture);

            await factory.createToken("Test Token", "TEST");

            const tokenAddress = await factory.getToken(0);
            const token = await ethers.getContractAt("BondingCurveToken", tokenAddress);

            expect(await token.name()).to.equal("Test Token");
            expect(await token.symbol()).to.equal("TEST");
            expect(await token.baseAsset()).to.equal(await baseAsset.getAddress());
            expect(await token.factory()).to.equal(await factory.getAddress());
        });

        it("Should store token info correctly", async function () {
            const { factory, owner, baseAsset } = await networkHelpers.loadFixture(deployFixture);

            await factory.createToken("Test Token", "TEST");

            const tokenAddress = await factory.getToken(0);
            const info = await factory.getTokenInfo(tokenAddress);

            expect(info.creator).to.equal(owner.address);
            expect(info.name).to.equal("Test Token");
            expect(info.symbol).to.equal("TEST");
            expect(info.timestamp).to.be.gt(0);
        });

        it("Should create multiple tokens", async function () {
            const { factory, baseAsset } = await networkHelpers.loadFixture(deployFixture);

            await factory.createToken("Token1", "TK1");
            await factory.createToken("Token2", "TK2");
            await factory.createToken("Token3", "TK3");

            expect(await factory.allTokensLength()).to.equal(3);

            const token1 = await ethers.getContractAt("BondingCurveToken", await factory.getToken(0));
            const token2 = await ethers.getContractAt("BondingCurveToken", await factory.getToken(1));
            const token3 = await ethers.getContractAt("BondingCurveToken", await factory.getToken(2));

            expect(await token1.name()).to.equal("Token1");
            expect(await token2.name()).to.equal("Token2");
            expect(await token3.name()).to.equal("Token3");
        });

        it("Should track correct creator for each token", async function () {
            const { factory, user1, user2, baseAsset } = await networkHelpers.loadFixture(
                deployFixture
            );

            await factory.connect(user1).createToken("User1 Token", "U1");
            await factory.connect(user2).createToken("User2 Token", "U2");

            const token1Info = await factory.getTokenInfo(await factory.getToken(0));
            const token2Info = await factory.getTokenInfo(await factory.getToken(1));

            expect(token1Info.creator).to.equal(user1.address);
            expect(token2Info.creator).to.equal(user2.address);
        });

        it("Should revert if name is empty", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);
            await expect(
                factory.createToken("", "TEST")
            ).to.be.revertedWithCustomError(factory, "InvalidName");
        });

        it("Should revert if symbol is empty", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);
            await expect(
                factory.createToken("Test Token", "")
            ).to.be.revertedWithCustomError(factory, "InvalidSymbol");
        });
    });

    describe("Pause Functionality", function () {
        it("Should allow owner to pause", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);
            await factory.pause();
            expect(await factory.paused()).to.be.true;
        });

        it("Should allow owner to unpause", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);
            await factory.pause();
            await factory.unpause();
            expect(await factory.paused()).to.be.false;
        });

        it("Should prevent token creation when paused", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);
            await factory.pause();

            await expect(
                factory.createToken("Test Token", "TEST")
            ).to.be.revertedWithCustomError(factory, "EnforcedPause");
        });

        it("Should allow token creation after unpause", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);
            await factory.pause();
            await factory.unpause();

            await expect(
                factory.createToken("Test Token", "TEST")
            ).to.not.be.revertedWith("");
        });

        it("Should revert if non-owner tries to pause", async function () {
            const { factory, user1 } = await networkHelpers.loadFixture(deployFixture);
            await expect(factory.connect(user1).pause()).to.be.revertedWithCustomError(
                factory,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should revert if non-owner tries to unpause", async function () {
            const { factory, owner, user1 } = await networkHelpers.loadFixture(deployFixture);
            await factory.connect(owner).pause();

            await expect(factory.connect(user1).unpause()).to.be.revertedWithCustomError(
                factory,
                "OwnableUnauthorizedAccount"
            );
        });
    });

    describe("Fee Recipient Management", function () {
        it("Should allow owner to update fee recipient", async function () {
            const { factory, user1 } = await networkHelpers.loadFixture(deployFixture);

            await expect(factory.setFeeRecipient(user1.address))
                .to.emit(factory, "FeeRecipientUpdated")
                .withArgs(await factory.feeRecipient(), user1.address);

            expect(await factory.feeRecipient()).to.equal(user1.address);
        });

        it("Should revert if non-owner tries to update fee recipient", async function () {
            const { factory, user1, user2 } = await networkHelpers.loadFixture(deployFixture);

            await expect(
                factory.connect(user1).setFeeRecipient(user2.address)
            ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
        });

        it("Should revert when setting fee recipient to zero address", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            await expect(
                factory.setFeeRecipient(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(factory, "InvalidFeeRecipient");
        });

        it("Should emit FeeRecipientUpdated event when updated", async function () {
            const { factory, owner, user1 } = await networkHelpers.loadFixture(deployFixture);

            const tx = factory.setFeeRecipient(user1.address);

            await expect(tx)
                .to.emit(factory, "FeeRecipientUpdated")
                .withArgs(owner.address, user1.address);
        });
    });

    describe("View Functions", function () {
        it("Should return correct token count", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            await factory.createToken("Token1", "TK1");
            await factory.createToken("Token2", "TK2");

            expect(await factory.allTokensLength()).to.equal(2);
        });

        it("Should return correct token at index", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            await factory.createToken("Token1", "TK1");
            await factory.createToken("Token2", "TK2");

            const token0 = await factory.getToken(0);
            const token1 = await factory.getToken(1);

            expect(token0).to.not.equal(ethers.ZeroAddress);
            expect(token1).to.not.equal(ethers.ZeroAddress);
            expect(token0).to.not.equal(token1);
        });

        it("Should return correct token info", async function () {
            const { factory, owner } = await networkHelpers.loadFixture(deployFixture);

            await factory.createToken("Token1", "TK1");

            const tokenAddress = await factory.getToken(0);
            const info = await factory.getTokenInfo(tokenAddress);

            expect(info.creator).to.equal(owner.address);
            expect(info.name).to.equal("Token1");
            expect(info.symbol).to.equal("TK1");
        });
    });

    describe("Gas Efficiency", function () {
        it("Should use minimal gas for token creation", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            const tx = await factory.createToken("Test Token", "TEST");

            const receipt = await tx.wait();
            const gasUsed = receipt?.gasUsed ?? 0n;

            // Expect gas usage to be reasonable (< 500k for proxy deployment)
            expect(gasUsed).to.be.lt(500000);
        });
    });
});
