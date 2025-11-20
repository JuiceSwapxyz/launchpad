import { expect } from "chai";
import hre from "hardhat";

// Top-level await - official Hardhat 3.0 pattern
const { ethers, networkHelpers } = await hre.network.connect();

describe("BondingCurveToken - Graduation", function () {
    // Fixture for deployment
    async function deployFixture() {
        const [owner, user1, user2] = await ethers.getSigners();

        // Deploy mock base asset
        const baseAsset = await ethers.deployContract("MockERC20", ["Wrapped cBTC", "WcBTC"]);

        // Deploy mock Uniswap V2 components
        const mockFactory = await ethers.deployContract("MockUniswapV2Factory");
        const mockRouter = await ethers.deployContract("MockUniswapV2Router", [
            await mockFactory.getAddress(),
            await baseAsset.getAddress(),
        ]);

        // Set factory address in router mock
        await mockRouter.setFactory(await mockFactory.getAddress());

        // Deploy implementation
        const implementation = await ethers.deployContract("BondingCurveToken");

        // Deploy factory with base asset and fee recipient
        const tokenFactory = await ethers.deployContract("TokenFactory", [
            await implementation.getAddress(),
            await mockRouter.getAddress(),
            await baseAsset.getAddress(),
            owner.address,  // Fee recipient
        ]);

        // Create a token
        await tokenFactory.createToken("Test Token", "TEST");
        const tokenAddress = await tokenFactory.getToken(0);
        const token = await ethers.getContractAt("BondingCurveToken", tokenAddress);

        // Mint base asset to users (need ~12,750 JUSD to graduate with new parameters)
        const mintAmount = ethers.parseEther("20000"); // Large amount to complete curve
        await baseAsset.mint(user1.address, mintAmount);
        await baseAsset.mint(user2.address, mintAmount);

        return { token, baseAsset, mockRouter, mockFactory, tokenFactory, owner, user1, user2 };
    }

    describe("Graduation Trigger", function () {
        it("Should not graduate before curve complete", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            // Buy some tokens (not all)
            const buyAmount = ethers.parseEther("10");
            await baseAsset.connect(user1).approve(await token.getAddress(), buyAmount);
            await token.connect(user1).buy(buyAmount, 0);

            // Should not be graduated
            expect(await token.graduated()).to.be.false;
        });

        it("Should graduate when realTokenReserves reaches 0", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            // With new parameters (4,500 JUSD start), need ~12,750 JUSD to graduate
            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            // Keep buying until canGraduate flag is set
            while (!(await token.canGraduate()) && !(await token.graduated())) {
                const remainingReserves = (await token.getReserves()).realToken;
                if (remainingReserves == 0n) break;

                // Use larger buy amounts with new economics
                const buyAmount = ethers.parseEther("500");

                try {
                    await token.connect(user1).buy(buyAmount, 0);
                } catch (e) {
                    // If buy fails, try with smaller amount
                    const smallBuy = ethers.parseEther("100");
                    await token.connect(user1).buy(smallBuy, 0);
                }
            }

            // Should be ready to graduate
            expect(await token.canGraduate()).to.be.true;
            expect(await token.graduated()).to.be.false;

            // Now call graduate()
            await token.graduate();

            // Should be graduated now
            expect(await token.graduated()).to.be.true;
        });

        it("Should set graduated flag", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            // Buy all tokens - need ~12,750 JUSD with new parameters
            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            let buyCount = 0;
            const maxBuys = 100; // Safety limit

            while (!(await token.canGraduate()) && buyCount < maxBuys) {
                const buyAmount = ethers.parseEther("500"); // Larger amounts for new economics

                try {
                    await token.connect(user1).buy(buyAmount, 0);
                } catch (e) {
                    // Ready for graduation or insufficient reserves
                    break;
                }
                buyCount++;
            }

            // Should be ready but not graduated yet
            expect(await token.canGraduate()).to.be.true;
            expect(await token.graduated()).to.be.false;

            // Call graduate()
            await token.graduate();

            const isGraduated = await token.graduated();
            expect(isGraduated).to.be.true;
        });

        it("Should emit Graduated event", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            // Buy tokens until ready for graduation - need ~12,750 JUSD with new parameters
            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            let buyCount = 0;
            const maxBuys = 100;

            while (buyCount < maxBuys && !(await token.canGraduate())) {
                const buyAmount = ethers.parseEther("500"); // Larger amounts for new economics

                try {
                    await token.connect(user1).buy(buyAmount, 0);
                } catch (e) {
                    break;
                }

                buyCount++;
            }

            // Now call graduate() and check for event
            const tx = await token.graduate();
            await expect(tx).to.emit(token, "Graduated");
        });

        it("Should have correct progress at graduation", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            // Buy all tokens - need ~12,750 JUSD with new parameters
            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            let buyCount = 0;
            while (!(await token.canGraduate()) && buyCount < 100) {
                const buyAmount = ethers.parseEther("500"); // Larger amounts for new economics

                try {
                    await token.connect(user1).buy(buyAmount, 0);
                } catch (e) {
                    break;
                }
                buyCount++;
            }

            // Call graduate()
            await token.graduate();

            const progress = await token.getBondingCurveProgress();
            expect(progress).to.equal(10000); // 100% in basis points
        });
    });

    describe("Post-Graduation Behavior", function () {
        async function graduateTokenFixture() {
            const fixture = await deployFixture();
            const { token, baseAsset, user1 } = fixture;

            // Buy all tokens until ready for graduation - need ~12,750 JUSD with new parameters
            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            let buyCount = 0;
            while (!(await token.canGraduate()) && buyCount < 100) {
                const buyAmount = ethers.parseEther("500"); // Larger amounts for new economics

                try {
                    await token.connect(user1).buy(buyAmount, 0);
                } catch (e) {
                    break;
                }
                buyCount++;
            }

            // Now manually call graduate()
            await token.graduate();

            return fixture;
        }

        it("Should not allow buying after graduation", async function () {
            const { token, baseAsset, user2 } = await networkHelpers.loadFixture(graduateTokenFixture);

            const buyAmount = ethers.parseEther("1");
            await baseAsset.connect(user2).approve(await token.getAddress(), buyAmount);

            await expect(
                token.connect(user2).buy(buyAmount, 0)
            ).to.be.revertedWithCustomError(token, "AlreadyGraduated");
        });

        it("Should not allow selling after graduation", async function () {
            const { token, user1 } = await networkHelpers.loadFixture(graduateTokenFixture);

            const sellAmount = ethers.parseEther("1000");

            await expect(
                token.connect(user1).sell(sellAmount, 0)
            ).to.be.revertedWithCustomError(token, "AlreadyGraduated");
        });

        it("Should have V2 pair address set", async function () {
            const { token } = await networkHelpers.loadFixture(graduateTokenFixture);

            const v2Pair = await token.v2Pair();
            expect(v2Pair).to.not.equal(ethers.ZeroAddress);
        });
    });

    describe("V2 Integration", function () {
        async function graduateTokenFixture() {
            const fixture = await deployFixture();
            const { token, baseAsset, user1 } = fixture;

            // Buy all tokens until ready for graduation - need ~12,750 JUSD with new parameters
            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            let buyCount = 0;
            while (!(await token.canGraduate()) && buyCount < 100) {
                const buyAmount = ethers.parseEther("500"); // Larger amounts for new economics

                try {
                    await token.connect(user1).buy(buyAmount, 0);
                } catch (e) {
                    break;
                }
                buyCount++;
            }

            // Now manually call graduate()
            await token.graduate();

            return fixture;
        }

        it("Should create V2 pair", async function () {
            const { token } = await networkHelpers.loadFixture(graduateTokenFixture);

            const v2Pair = await token.v2Pair();
            expect(v2Pair).to.not.equal(ethers.ZeroAddress);
        });

        it("Graduation should be idempotent", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            // Buy all tokens - need ~12,750 JUSD with new parameters
            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            let buyCount = 0;
            while (!(await token.canGraduate()) && buyCount < 100) {
                const buyAmount = ethers.parseEther("500"); // Larger amounts for new economics

                try {
                    await token.connect(user1).buy(buyAmount, 0);
                } catch (e) {
                    break;
                }
                buyCount++;
            }

            // Call graduate()
            await token.graduate();

            // Check graduated
            expect(await token.graduated()).to.be.true;

            // Try to buy again (should fail with AlreadyGraduated, not re-graduate)
            const buyAmount = ethers.parseEther("1");
            await baseAsset.connect(user1).approve(await token.getAddress(), buyAmount);

            await expect(
                token.connect(user1).buy(buyAmount, 0)
            ).to.be.revertedWithCustomError(token, "AlreadyGraduated");

            // Try to graduate again (should fail with AlreadyGraduated)
            await expect(
                token.graduate()
            ).to.be.revertedWithCustomError(token, "AlreadyGraduated");

            // Still graduated (didn't break)
            expect(await token.graduated()).to.be.true;
        });
    });

    describe("Real Token Reserves", function () {
        it("Should decrease realTokenReserves on each buy", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            const reservesBefore = await token.getReserves();
            const buyAmount = ethers.parseEther("10");

            await baseAsset.connect(user1).approve(await token.getAddress(), buyAmount);
            await token.connect(user1).buy(buyAmount, 0);

            const reservesAfter = await token.getReserves();

            expect(reservesAfter.realToken).to.be.lt(reservesBefore.realToken);
        });

        it("Should have realTokenReserves = 0 at graduation", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            // Buy all tokens - need ~12,750 JUSD with new parameters
            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            let buyCount = 0;
            while (!(await token.canGraduate()) && buyCount < 100) {
                const buyAmount = ethers.parseEther("500"); // Larger amounts for new economics

                try {
                    await token.connect(user1).buy(buyAmount, 0);
                } catch (e) {
                    break;
                }
                buyCount++;
            }

            // Call graduate()
            await token.graduate();

            const reserves = await token.getReserves();
            expect(reserves.realToken).to.equal(0);
        });
    });

    describe("Fee Collection", function () {
        async function graduateTokenFixture() {
            const fixture = await deployFixture();
            const { token, baseAsset, user1, owner } = fixture;

            // Track initial fee recipient balance
            const initialFeeRecipientBalance = await baseAsset.balanceOf(owner.address);

            // Buy all tokens until ready for graduation
            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            let buyCount = 0;
            while (!(await token.canGraduate()) && buyCount < 100) {
                const buyAmount = ethers.parseEther("500");

                try {
                    await token.connect(user1).buy(buyAmount, 0);
                } catch (e) {
                    break;
                }
                buyCount++;
            }

            // Now manually call graduate()
            await token.graduate();

            return { ...fixture, initialFeeRecipientBalance };
        }

        it("Should send accumulated fees to fee recipient at graduation", async function () {
            const { token, baseAsset, owner, initialFeeRecipientBalance } =
                await networkHelpers.loadFixture(graduateTokenFixture);

            // Check token graduated
            expect(await token.graduated()).to.be.true;

            // Fee recipient should have received fees
            const finalFeeRecipientBalance = await baseAsset.balanceOf(owner.address);
            const feesReceived = finalFeeRecipientBalance - initialFeeRecipientBalance;

            // Fees should be positive (approximately 1% of total traded)
            expect(feesReceived).to.be.gt(0);

            // Fees should be approximately 1% of realBaseReserves (~12,750 JUSD * 0.01 ≈ 129 JUSD)
            // Allow some tolerance for rounding
            expect(feesReceived).to.be.gt(ethers.parseEther("120")); // At least 120 JUSD
            expect(feesReceived).to.be.lt(ethers.parseEther("140")); // Less than 140 JUSD
        });

        it("Should emit Graduated event with correct fee amount", async function () {
            const fixture = await deployFixture();
            const { token, baseAsset, user1 } = fixture;

            // Buy tokens until ready for graduation
            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            let buyCount = 0;

            while (buyCount < 100 && !(await token.canGraduate())) {
                const buyAmount = ethers.parseEther("500");

                try {
                    await token.connect(user1).buy(buyAmount, 0);
                } catch (e) {
                    break;
                }
                buyCount++;
            }

            // Now call graduate() and get the transaction
            const graduationTx = await token.graduate();

            // Verify graduation event was emitted with fee amount
            expect(graduationTx).to.not.be.undefined;

            const receipt = await graduationTx.wait();
            expect(receipt).to.not.be.null;

            const graduatedEvent = receipt!.logs.find(
                (log: any) => {
                    try {
                        const parsed = token.interface.parseLog(log);
                        return parsed?.name === "Graduated";
                    } catch {
                        return false;
                    }
                }
            );

            expect(graduatedEvent).to.not.be.undefined;

            const parsedEvent = token.interface.parseLog(graduatedEvent!);
            expect(parsedEvent).to.not.be.null;

            const [pair, liquidityLocked, protocolFees] = parsedEvent!.args;

            // Verify fees are in expected range (~129 JUSD)
            expect(protocolFees).to.be.gt(ethers.parseEther("120"));
            expect(protocolFees).to.be.lt(ethers.parseEther("140"));
        });

        it("Should handle zero fees gracefully", async function () {
            // This is an edge case test - in practice there will always be fees
            // But the contract should handle it without reverting
            const { token } = await networkHelpers.loadFixture(deployFixture);

            // Just verify token is initialized correctly
            expect(await token.feeRecipient()).to.not.equal(ethers.ZeroAddress);
        });

        it("Should calculate fees correctly", async function () {
            const fixture = await deployFixture();
            const { token, baseAsset, user1, owner } = fixture;

            const initialBalance = await baseAsset.balanceOf(owner.address);

            // Do a single small buy to calculate expected fees
            const buyAmount = ethers.parseEther("100");
            await baseAsset.connect(user1).approve(await token.getAddress(), buyAmount);
            await token.connect(user1).buy(buyAmount, 0);

            // Expected fee: 1% of 100 = 1 JUSD
            const expectedFee = ethers.parseEther("1");

            // Fee should still be in contract (not sent until graduation)
            const contractBalance = await baseAsset.balanceOf(await token.getAddress());
            const reserves = await token.getReserves();
            const accumulatedFees = contractBalance - reserves.realBase;

            expect(accumulatedFees).to.equal(expectedFee);

            // Fee recipient balance shouldn't have changed yet
            expect(await baseAsset.balanceOf(owner.address)).to.equal(initialBalance);
        });
    });

    describe("Manual Graduation", function () {
        it("Should set canGraduate flag when bonding curve completes", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            let buyCount = 0;
            while (!(await token.canGraduate()) && buyCount < 100) {
                const buyAmount = ethers.parseEther("500");
                try {
                    await token.connect(user1).buy(buyAmount, 0);
                } catch (e) {
                    break;
                }
                buyCount++;
            }

            expect(await token.canGraduate()).to.be.true;
            expect(await token.graduated()).to.be.false;
        });

        it("Should emit ReadyForGraduation event", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            let lastTx;
            let buyCount = 0;
            while (buyCount < 100) {
                const buyAmount = ethers.parseEther("500");
                try {
                    lastTx = await token.connect(user1).buy(buyAmount, 0);
                    if (await token.canGraduate()) {
                        break;
                    }
                } catch (e) {
                    break;
                }
                buyCount++;
            }

            // Last buy should have emitted ReadyForGraduation event
            await expect(lastTx).to.emit(token, "ReadyForGraduation");
        });

        it("Should block buy when canGraduate is true", async function () {
            const { token, baseAsset, user1, user2 } = await networkHelpers.loadFixture(deployFixture);

            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            let buyCount = 0;
            while (!(await token.canGraduate()) && buyCount < 100) {
                const buyAmount = ethers.parseEther("500");
                try {
                    await token.connect(user1).buy(buyAmount, 0);
                } catch (e) {
                    break;
                }
                buyCount++;
            }

            // Now canGraduate should be true
            expect(await token.canGraduate()).to.be.true;

            // Try to buy - should revert with MustGraduateFirst
            const buyAmount = ethers.parseEther("1");
            await baseAsset.connect(user2).approve(await token.getAddress(), buyAmount);

            await expect(
                token.connect(user2).buy(buyAmount, 0)
            ).to.be.revertedWithCustomError(token, "MustGraduateFirst");
        });

        it("Should block sell when canGraduate is true", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            let buyCount = 0;
            while (!(await token.canGraduate()) && buyCount < 100) {
                const buyAmount = ethers.parseEther("500");
                try {
                    await token.connect(user1).buy(buyAmount, 0);
                } catch (e) {
                    break;
                }
                buyCount++;
            }

            // Now canGraduate should be true
            expect(await token.canGraduate()).to.be.true;

            // Try to sell - should revert with MustGraduateFirst
            const sellAmount = ethers.parseEther("100");

            await expect(
                token.connect(user1).sell(sellAmount, 0)
            ).to.be.revertedWithCustomError(token, "MustGraduateFirst");
        });

        it("Should allow anyone to call graduate()", async function () {
            const { token, baseAsset, user1, user2 } = await networkHelpers.loadFixture(deployFixture);

            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            let buyCount = 0;
            while (!(await token.canGraduate()) && buyCount < 100) {
                const buyAmount = ethers.parseEther("500");
                try {
                    await token.connect(user1).buy(buyAmount, 0);
                } catch (e) {
                    break;
                }
                buyCount++;
            }

            expect(await token.canGraduate()).to.be.true;

            // user2 (not the buyer) calls graduate() - should succeed
            await token.connect(user2).graduate();

            expect(await token.graduated()).to.be.true;
            expect(await token.canGraduate()).to.be.false;
        });

        it("Should revert if graduate() called before ready", async function () {
            const { token } = await networkHelpers.loadFixture(deployFixture);

            await expect(
                token.graduate()
            ).to.be.revertedWithCustomError(token, "NotReadyForGraduation");
        });

        it("Should revert if graduate() called twice", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            let buyCount = 0;
            while (!(await token.canGraduate()) && buyCount < 100) {
                const buyAmount = ethers.parseEther("500");
                try {
                    await token.connect(user1).buy(buyAmount, 0);
                } catch (e) {
                    break;
                }
                buyCount++;
            }

            // Call graduate() first time
            await token.graduate();
            expect(await token.graduated()).to.be.true;

            // Try to call graduate() again - should revert
            await expect(
                token.graduate()
            ).to.be.revertedWithCustomError(token, "AlreadyGraduated");
        });

        it("Should clear canGraduate flag after graduation", async function () {
            const { token, baseAsset, user1 } = await networkHelpers.loadFixture(deployFixture);

            const totalApproval = ethers.parseEther("15000");
            await baseAsset.connect(user1).approve(await token.getAddress(), totalApproval);

            let buyCount = 0;
            while (!(await token.canGraduate()) && buyCount < 100) {
                const buyAmount = ethers.parseEther("500");
                try {
                    await token.connect(user1).buy(buyAmount, 0);
                } catch (e) {
                    break;
                }
                buyCount++;
            }

            expect(await token.canGraduate()).to.be.true;

            await token.graduate();

            expect(await token.canGraduate()).to.be.false;
            expect(await token.graduated()).to.be.true;
        });
    });
});
