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

        // Deploy mock V2 factory (uses CREATE2 for deterministic pair addresses)
        const v2Factory = await ethers.deployContract("MockUniswapV2Factory");

        // Get init code hash from mock factory
        const initCodeHash = await v2Factory.INIT_CODE_PAIR_HASH();

        // Deploy mock router with factory address
        const router = await ethers.deployContract("MockUniswapV2Router", [
            await v2Factory.getAddress(),
            ethers.ZeroAddress,
        ]);

        // Deploy implementation contract
        const implementation = await ethers.deployContract("BondingCurveToken");

        // Deploy factory with base asset, fee recipient, and init code hash
        const factory = await ethers.deployContract("TokenFactory", [
            await implementation.getAddress(),
            await router.getAddress(),
            await baseAsset.getAddress(),
            owner.address,  // Fee recipient set to owner for testing
            ethers.parseEther("4500"),  // Initial virtual base reserves
            initCodeHash,  // Init code hash for pair address computation
        ]);

        return { factory, implementation, baseAsset, router, v2Factory, initCodeHash, owner, user1, user2 };
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
            const { router, baseAsset, owner, initCodeHash } = await networkHelpers.loadFixture(deployFixture);
            await expect(
                ethers.deployContract("TokenFactory", [
                    ethers.ZeroAddress,
                    await router.getAddress(),
                    await baseAsset.getAddress(),
                    owner.address,
                    ethers.parseEther("4500"),
                    initCodeHash,
                ])
            ).to.be.revertedWithCustomError(
                await ethers.getContractFactory("TokenFactory"),
                "InvalidImplementation"
            );
        });

        it("Should revert if router is zero address", async function () {
            const { implementation, baseAsset, owner, initCodeHash } = await networkHelpers.loadFixture(deployFixture);
            await expect(
                ethers.deployContract("TokenFactory", [
                    await implementation.getAddress(),
                    ethers.ZeroAddress,
                    await baseAsset.getAddress(),
                    owner.address,
                    ethers.parseEther("4500"),
                    initCodeHash,
                ])
            ).to.be.revertedWithCustomError(
                await ethers.getContractFactory("TokenFactory"),
                "InvalidRouter"
            );
        });

        it("Should revert if base asset is zero address", async function () {
            const { implementation, router, owner, initCodeHash } = await networkHelpers.loadFixture(deployFixture);
            await expect(
                ethers.deployContract("TokenFactory", [
                    await implementation.getAddress(),
                    await router.getAddress(),
                    ethers.ZeroAddress,
                    owner.address,
                    ethers.parseEther("4500"),
                    initCodeHash,
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
            const { implementation, router, baseAsset, initCodeHash } = await networkHelpers.loadFixture(deployFixture);
            await expect(
                ethers.deployContract("TokenFactory", [
                    await implementation.getAddress(),
                    await router.getAddress(),
                    await baseAsset.getAddress(),
                    ethers.ZeroAddress,
                    ethers.parseEther("4500"),
                    initCodeHash,
                ])
            ).to.be.revertedWithCustomError(
                await ethers.getContractFactory("TokenFactory"),
                "InvalidFeeRecipient"
            );
        });

        it("Should set the correct init code hash", async function () {
            const { factory, initCodeHash } = await networkHelpers.loadFixture(deployFixture);
            expect(await factory.initCodeHash()).to.equal(initCodeHash);
        });

        it("Should revert if init code hash is zero", async function () {
            const { implementation, router, baseAsset, owner } = await networkHelpers.loadFixture(deployFixture);
            await expect(
                ethers.deployContract("TokenFactory", [
                    await implementation.getAddress(),
                    await router.getAddress(),
                    await baseAsset.getAddress(),
                    owner.address,
                    ethers.parseEther("4500"),
                    ethers.ZeroHash,
                ])
            ).to.be.revertedWithCustomError(
                await ethers.getContractFactory("TokenFactory"),
                "InvalidInitCodeHash"
            );
        });
    });

    describe("Token Creation", function () {
        it("Should create a new token successfully", async function () {
            const { factory, owner, baseAsset } = await networkHelpers.loadFixture(deployFixture);

            const tx = await factory.createToken("Test Token", "TEST", "ipfs://QmTest123");

            await expect(tx)
                .to.emit(factory, "TokenCreated")
                .withArgs(
                    await factory.getToken(0),
                    owner.address,
                    "Test Token",
                    "TEST",
                    await baseAsset.getAddress(),
                    ethers.parseEther("4500"),  // initialVirtualBaseReserves
                    owner.address,              // feeRecipient
                    "ipfs://QmTest123"          // metadataURI
                );

            expect(await factory.allTokensLength()).to.equal(1);
        });

        it("Should properly initialize the created token", async function () {
            const { factory, baseAsset } = await networkHelpers.loadFixture(deployFixture);

            await factory.createToken("Test Token", "TEST", "ipfs://QmTest123");

            const tokenAddress = await factory.getToken(0);
            const token = await ethers.getContractAt("BondingCurveToken", tokenAddress);

            expect(await token.name()).to.equal("Test Token");
            expect(await token.symbol()).to.equal("TEST");
            expect(await token.baseAsset()).to.equal(await baseAsset.getAddress());
            expect(await token.factory()).to.equal(await factory.getAddress());
        });

        it("Should store token info correctly", async function () {
            const { factory, owner, baseAsset } = await networkHelpers.loadFixture(deployFixture);

            await factory.createToken("Test Token", "TEST", "ipfs://QmTest123");

            const tokenAddress = await factory.getToken(0);
            const info = await factory.getTokenInfo(tokenAddress);

            expect(info.creator).to.equal(owner.address);
            expect(info.name).to.equal("Test Token");
            expect(info.symbol).to.equal("TEST");
            expect(info.metadataURI).to.equal("ipfs://QmTest123");
            expect(info.timestamp).to.be.gt(0);
        });

        it("Should create multiple tokens", async function () {
            const { factory, baseAsset } = await networkHelpers.loadFixture(deployFixture);

            await factory.createToken("Token1", "TK1", "ipfs://QmToken1");
            await factory.createToken("Token2", "TK2", "ipfs://QmToken2");
            await factory.createToken("Token3", "TK3", "ipfs://QmToken3");

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

            await factory.connect(user1).createToken("User1 Token", "U1", "ipfs://QmUser1");
            await factory.connect(user2).createToken("User2 Token", "U2", "ipfs://QmUser2");

            const token1Info = await factory.getTokenInfo(await factory.getToken(0));
            const token2Info = await factory.getTokenInfo(await factory.getToken(1));

            expect(token1Info.creator).to.equal(user1.address);
            expect(token2Info.creator).to.equal(user2.address);
        });

        it("Should revert if name is empty", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);
            await expect(
                factory.createToken("", "TEST", "ipfs://QmTest123")
            ).to.be.revertedWithCustomError(factory, "InvalidName");
        });

        it("Should revert if symbol is empty", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);
            await expect(
                factory.createToken("Test Token", "", "ipfs://QmTest123")
            ).to.be.revertedWithCustomError(factory, "InvalidSymbol");
        });

        it("Should revert if metadata URI is empty", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);
            await expect(
                factory.createToken("Test Token", "TEST", "")
            ).to.be.revertedWithCustomError(factory, "InvalidMetadataURI");
        });

        it("Should accept various metadata URI formats", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            // IPFS
            await expect(factory.createToken("Token1", "TK1", "ipfs://QmTest123"))
                .to.not.be.revertedWith("");

            // Arweave
            await expect(factory.createToken("Token2", "TK2", "ar://abc123def"))
                .to.not.be.revertedWith("");

            // HTTPS
            await expect(factory.createToken("Token3", "TK3", "https://example.com/metadata.json"))
                .to.not.be.revertedWith("");

            // Data URI
            await expect(factory.createToken("Token4", "TK4", "data:application/json;base64,eyJ0ZXN0IjoidHJ1ZSJ9"))
                .to.not.be.revertedWith("");
        });

        it("Should handle long metadata URIs", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            // Test with a very long URI (data URI with embedded JSON)
            const longMetadata = "data:application/json;base64," + "A".repeat(1000);
            await expect(factory.createToken("Test Token", "TEST", longMetadata))
                .to.not.be.revertedWith("");
        });

        it("Should handle multiple tokens with different metadata", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            await factory.createToken("Token1", "TK1", "ipfs://QmToken1");
            await factory.createToken("Token2", "TK2", "ipfs://QmToken2");
            await factory.createToken("Token3", "TK3", "ar://Token3");

            const info1 = await factory.getTokenInfo(await factory.getToken(0));
            const info2 = await factory.getTokenInfo(await factory.getToken(1));
            const info3 = await factory.getTokenInfo(await factory.getToken(2));

            expect(info1.metadataURI).to.equal("ipfs://QmToken1");
            expect(info2.metadataURI).to.equal("ipfs://QmToken2");
            expect(info3.metadataURI).to.equal("ar://Token3");
        });
    });

    describe("Metadata URI Security", function () {
        it("Should reject URIs exceeding maximum length", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            // Create URI just over 1KB limit
            const tooLongURI = "ipfs://Qm" + "a".repeat(1020);

            await expect(
                factory.createToken("Test Token", "TEST", tooLongURI)
            ).to.be.revertedWithCustomError(factory, "MetadataURITooLong");
        });

        it("Should accept URI at exactly maximum length", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            // Create URI at exactly 1KB
            const maxLengthURI = "ipfs://Qm" + "a".repeat(1015); // Total 1024 bytes

            await expect(
                factory.createToken("Test Token", "TEST", maxLengthURI)
            ).to.not.be.revertedWith("");
        });

        it("Should reject URIs with null bytes", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            const nullByteURI = "ipfs://Qm\x00malicious";

            await expect(
                factory.createToken("Test Token", "TEST", nullByteURI)
            ).to.be.revertedWithCustomError(factory, "InvalidControlCharacter");
        });

        it("Should reject URIs with newline characters", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            const newlineURI = "ipfs://Qm\n\rmalicious";

            await expect(
                factory.createToken("Test Token", "TEST", newlineURI)
            ).to.be.revertedWithCustomError(factory, "InvalidControlCharacter");
        });

        it("Should reject URIs with control characters", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            const controlCharURI = "ipfs://Qm\x01\x02\x03";

            await expect(
                factory.createToken("Test Token", "TEST", controlCharURI)
            ).to.be.revertedWithCustomError(factory, "InvalidControlCharacter");
        });

        it("Should reject URIs with tab characters", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            // Tab (0x09) is now BLOCKED to prevent alignment spoofing
            const tabURI = "ipfs://Qm\tTest";

            await expect(
                factory.createToken("Test Token", "TEST", tabURI)
            ).to.be.revertedWithCustomError(factory, "InvalidControlCharacter");
        });

        it("Should reject URIs with DEL character", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            // DEL (0x7F) is a control character
            const delURI = "ipfs://Qm\x7FTest";

            await expect(
                factory.createToken("Test Token", "TEST", delURI)
            ).to.be.revertedWithCustomError(factory, "InvalidControlCharacter");
        });

        it("Should reject names with control characters", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            const controlCharName = "Test\x00Token";

            await expect(
                factory.createToken(controlCharName, "TEST", "ipfs://QmTest")
            ).to.be.revertedWithCustomError(factory, "InvalidControlCharacter");
        });

        it("Should reject names with tab characters", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            const tabName = "Test\tToken";

            await expect(
                factory.createToken(tabName, "TEST", "ipfs://QmTest")
            ).to.be.revertedWithCustomError(factory, "InvalidControlCharacter");
        });

        it("Should reject symbols with lowercase letters", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            await expect(
                factory.createToken("Test Token", "test", "ipfs://QmTest")
            ).to.be.revertedWithCustomError(factory, "InvalidSymbolCharacter");
        });

        it("Should reject symbols with special characters", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            await expect(
                factory.createToken("Test Token", "TE$T", "ipfs://QmTest")
            ).to.be.revertedWithCustomError(factory, "InvalidSymbolCharacter");
        });

        it("Should reject symbols with spaces", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            await expect(
                factory.createToken("Test Token", "TE ST", "ipfs://QmTest")
            ).to.be.revertedWithCustomError(factory, "InvalidSymbolCharacter");
        });

        it("Should accept symbols with only uppercase and numbers", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            await expect(
                factory.createToken("Test Token", "TOKEN123", "ipfs://QmTest")
            ).to.not.be.revertedWith("");
        });

        it("Should accept URIs with Unicode emoji", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            const emojiURI = "ipfs://QmTest🚀💎🌙";

            await expect(
                factory.createToken("Test Token", "TEST", emojiURI)
            ).to.not.be.revertedWith("");

            const tokenAddr = await factory.getToken(0);
            const info = await factory.getTokenInfo(tokenAddr);
            expect(info.metadataURI).to.equal(emojiURI);
        });

        it("Should accept URIs with international characters", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            const unicodeURI = "ipfs://Qm测试中文العربية";

            await expect(
                factory.createToken("Test Token", "TEST", unicodeURI)
            ).to.not.be.revertedWith("");

            const tokenAddr = await factory.getToken(0);
            const info = await factory.getTokenInfo(tokenAddr);
            expect(info.metadataURI).to.equal(unicodeURI);
        });

        it("Should reject names exceeding maximum length", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            const longName = "A".repeat(101); // Over 100 char limit

            await expect(
                factory.createToken(longName, "TEST", "ipfs://QmTest")
            ).to.be.revertedWithCustomError(factory, "NameTooLong");
        });

        it("Should reject symbols exceeding maximum length", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            const longSymbol = "A".repeat(21); // Over 20 char limit

            await expect(
                factory.createToken("Test Token", longSymbol, "ipfs://QmTest")
            ).to.be.revertedWithCustomError(factory, "SymbolTooLong");
        });

        it("Should accept name at maximum length", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            const maxName = "A".repeat(100); // Exactly 100 chars

            await expect(
                factory.createToken(maxName, "TEST", "ipfs://QmTest")
            ).to.not.be.revertedWith("");
        });

        it("Should accept symbol at maximum length", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            const maxSymbol = "A".repeat(20); // Exactly 20 chars

            await expect(
                factory.createToken("Test Token", maxSymbol, "ipfs://QmTest")
            ).to.not.be.revertedWith("");
        });
    });

    describe("Metadata Persistence", function () {
        it("Should preserve metadata after buy operations", async function () {
            const { factory, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            const metadataURI = "ipfs://QmPersistenceTest";
            await factory.createToken("Test Token", "TEST", metadataURI);

            const tokenAddress = await factory.getToken(0);
            const token = await ethers.getContractAt("BondingCurveToken", tokenAddress);

            // Perform buy operation
            const buyAmount = ethers.parseEther("10");
            await baseAsset.connect(user1).approve(tokenAddress, buyAmount);
            await baseAsset.mint(user1.address, buyAmount);
            const quote = await token.calculateBuy(buyAmount);
            await token.connect(user1).buy(buyAmount, quote);

            // Verify metadata unchanged
            const info = await factory.getTokenInfo(tokenAddress);
            expect(info.metadataURI).to.equal(metadataURI);
        });

        it("Should preserve metadata after sell operations", async function () {
            const { factory, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            const metadataURI = "ipfs://QmSellTest";
            await factory.createToken("Test Token", "TEST", metadataURI);

            const tokenAddress = await factory.getToken(0);
            const token = await ethers.getContractAt("BondingCurveToken", tokenAddress);

            // Buy tokens first
            const buyAmount = ethers.parseEther("10");
            await baseAsset.connect(user1).approve(tokenAddress, buyAmount);
            await baseAsset.mint(user1.address, buyAmount);
            const buyQuote = await token.calculateBuy(buyAmount);
            await token.connect(user1).buy(buyAmount, buyQuote);

            // Sell tokens
            const sellAmount = buyQuote / 2n;
            const sellQuote = await token.calculateSell(sellAmount);
            await token.connect(user1).sell(sellAmount, sellQuote);

            // Verify metadata unchanged
            const info = await factory.getTokenInfo(tokenAddress);
            expect(info.metadataURI).to.equal(metadataURI);
        });

        it("Should preserve metadata after factory pause/unpause", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            const metadataURI = "ipfs://QmPauseTest";
            await factory.createToken("Test Token", "TEST", metadataURI);

            const tokenAddress = await factory.getToken(0);

            // Pause factory
            await factory.pause();

            // Verify metadata still readable
            let info = await factory.getTokenInfo(tokenAddress);
            expect(info.metadataURI).to.equal(metadataURI);

            // Unpause
            await factory.unpause();

            // Verify metadata still unchanged
            info = await factory.getTokenInfo(tokenAddress);
            expect(info.metadataURI).to.equal(metadataURI);
        });
    });

    describe("Metadata Edge Cases", function () {
        it("Should handle getTokenInfo for non-existent token", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            // Query non-existent token
            const randomAddress = ethers.Wallet.createRandom().address;
            const info = await factory.getTokenInfo(randomAddress);

            // Should return empty struct
            expect(info.creator).to.equal(ethers.ZeroAddress);
            expect(info.timestamp).to.equal(0);
            expect(info.name).to.equal("");
            expect(info.symbol).to.equal("");
            expect(info.metadataURI).to.equal("");
        });

        it("Should handle multiple tokens with identical metadata URIs", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            const sharedURI = "ipfs://QmShared123";

            await factory.createToken("Token1", "TK1", sharedURI);
            await factory.createToken("Token2", "TK2", sharedURI);
            await factory.createToken("Token3", "TK3", sharedURI);

            // All should have same metadata URI
            const info1 = await factory.getTokenInfo(await factory.getToken(0));
            const info2 = await factory.getTokenInfo(await factory.getToken(1));
            const info3 = await factory.getTokenInfo(await factory.getToken(2));

            expect(info1.metadataURI).to.equal(sharedURI);
            expect(info2.metadataURI).to.equal(sharedURI);
            expect(info3.metadataURI).to.equal(sharedURI);
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
                factory.createToken("Test Token", "TEST", "ipfs://QmTest123")
            ).to.be.revertedWithCustomError(factory, "EnforcedPause");
        });

        it("Should allow token creation after unpause", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);
            await factory.pause();
            await factory.unpause();

            await expect(
                factory.createToken("Test Token", "TEST", "ipfs://QmTest123")
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

            await factory.createToken("Token1", "TK1", "ipfs://QmToken1");
            await factory.createToken("Token2", "TK2", "ipfs://QmToken2");

            expect(await factory.allTokensLength()).to.equal(2);
        });

        it("Should return correct token at index", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            await factory.createToken("Token1", "TK1", "ipfs://QmToken1");
            await factory.createToken("Token2", "TK2", "ipfs://QmToken2");

            const token0 = await factory.getToken(0);
            const token1 = await factory.getToken(1);

            expect(token0).to.not.equal(ethers.ZeroAddress);
            expect(token1).to.not.equal(ethers.ZeroAddress);
            expect(token0).to.not.equal(token1);
        });

        it("Should return correct token info", async function () {
            const { factory, owner } = await networkHelpers.loadFixture(deployFixture);

            await factory.createToken("Token1", "TK1", "ipfs://QmToken1");

            const tokenAddress = await factory.getToken(0);
            const info = await factory.getTokenInfo(tokenAddress);

            expect(info.creator).to.equal(owner.address);
            expect(info.name).to.equal("Token1");
            expect(info.symbol).to.equal("TK1");
            expect(info.metadataURI).to.equal("ipfs://QmToken1");
        });

        it("Should return correct metadata URI from token contract", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            // Create token with specific metadata URI
            const metadataURI = "ipfs://QmTestMetadataURI123";
            await factory.createToken("Test Token", "TEST", metadataURI);

            // Get token address and instantiate BondingCurveToken
            const tokenAddress = await factory.getToken(0);
            const token = await ethers.getContractAt("BondingCurveToken", tokenAddress);

            // Verify metadataURI() function returns correct value
            expect(await token.metadataURI()).to.equal(metadataURI);
        });
    });

    describe("Gas Efficiency", function () {
        it("Should use minimal gas for token creation", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);

            const tx = await factory.createToken("Test Token", "TEST", "ipfs://QmTest123");

            const receipt = await tx.wait();
            const gasUsed = receipt?.gasUsed ?? 0n;

            // Security validation adds ~20k gas (control char checks, length checks, symbol validation)
            // Acceptable trade-off for comprehensive security: ~520k → ~540k
            expect(gasUsed).to.be.lt(540000);
        });
    });

    describe("Initial Virtual Base Reserves Management", function () {
        it("Should set the correct initial virtual base reserves in constructor", async function () {
            const { factory } = await networkHelpers.loadFixture(deployFixture);
            expect(await factory.initialVirtualBaseReserves()).to.equal(ethers.parseEther("4500"));
        });

        it("Should revert if initial virtual base reserves is zero in constructor", async function () {
            const { implementation, router, baseAsset, owner, initCodeHash } = await networkHelpers.loadFixture(deployFixture);
            await expect(
                ethers.deployContract("TokenFactory", [
                    await implementation.getAddress(),
                    await router.getAddress(),
                    await baseAsset.getAddress(),
                    owner.address,
                    0,  // Zero virtual base reserves
                    initCodeHash,
                ])
            ).to.be.revertedWithCustomError(
                await ethers.getContractFactory("TokenFactory"),
                "InvalidVirtualBaseReserves"
            );
        });

        it("Should allow owner to update initial virtual base reserves", async function () {
            const { factory, owner } = await networkHelpers.loadFixture(deployFixture);

            const newValue = ethers.parseEther("5000");
            await expect(factory.connect(owner).setInitialVirtualBaseReserves(newValue))
                .to.emit(factory, "InitialVirtualBaseReservesUpdated")
                .withArgs(ethers.parseEther("4500"), newValue);

            expect(await factory.initialVirtualBaseReserves()).to.equal(newValue);
        });

        it("Should revert if non-owner tries to update initial virtual base reserves", async function () {
            const { factory, user1 } = await networkHelpers.loadFixture(deployFixture);

            await expect(
                factory.connect(user1).setInitialVirtualBaseReserves(ethers.parseEther("5000"))
            ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
        });

        it("Should revert when setting initial virtual base reserves to zero", async function () {
            const { factory, owner } = await networkHelpers.loadFixture(deployFixture);

            await expect(
                factory.connect(owner).setInitialVirtualBaseReserves(0)
            ).to.be.revertedWithCustomError(factory, "InvalidVirtualBaseReserves");
        });

        it("Should emit event when initial virtual base reserves is updated", async function () {
            const { factory, owner } = await networkHelpers.loadFixture(deployFixture);

            const oldValue = ethers.parseEther("4500");
            const newValue = ethers.parseEther("6000");

            await expect(factory.connect(owner).setInitialVirtualBaseReserves(newValue))
                .to.emit(factory, "InitialVirtualBaseReservesUpdated")
                .withArgs(oldValue, newValue);
        });

        it("Should not affect existing tokens when updated", async function () {
            const { factory, owner, baseAsset } = await networkHelpers.loadFixture(deployFixture);

            // Create a token with initial setting (4500)
            const tx1 = await factory.createToken("Token1", "TK1", "ipfs://QmToken1");
            const token1Address = await factory.getToken(0);

            // Check token1 creation event has 4500
            await expect(tx1)
                .to.emit(factory, "TokenCreated")
                .withArgs(
                    token1Address,
                    owner.address,
                    "Token1",
                    "TK1",
                    await baseAsset.getAddress(),
                    ethers.parseEther("4500"),  // initialVirtualBaseReserves
                    owner.address,              // feeRecipient
                    "ipfs://QmToken1"           // metadataURI
                );

            // Update factory setting to 6000
            await factory.connect(owner).setInitialVirtualBaseReserves(ethers.parseEther("6000"));

            // Create a new token with new setting (6000)
            const tx2 = await factory.createToken("Token2", "TK2", "ipfs://QmToken2");
            const token2Address = await factory.getToken(1);

            // Token2 creation event should have 6000
            await expect(tx2)
                .to.emit(factory, "TokenCreated")
                .withArgs(
                    token2Address,
                    owner.address,
                    "Token2",
                    "TK2",
                    await baseAsset.getAddress(),
                    ethers.parseEther("6000"),  // New initialVirtualBaseReserves
                    owner.address,              // feeRecipient
                    "ipfs://QmToken2"           // metadataURI
                );
        });
    });
});
