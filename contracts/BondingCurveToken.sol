// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";

/**
 * @notice Interface for TokenFactory to retrieve token metadata
 */
interface ITokenFactory {
    function getTokenInfo(address token)
        external
        view
        returns (
            address creator,
            uint96 timestamp,
            string memory name,
            string memory symbol,
            string memory metadataURI
        );
}

/**
 * @title BondingCurveToken
 * @notice ERC20 token with bonding curve trading and automatic Uniswap V2 graduation
 * @dev Implements virtual + real reserve system matching pump.fun mechanics
 * @dev True fair launch: No admin pause after deployment (permissionless trading)
 */
contract BondingCurveToken is ERC20, ReentrancyGuard, Ownable {
    /* ========== CONSTANTS ========== */

    /// @notice Total supply of tokens (1 billion)
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;

    /// @notice Initial virtual token reserves for pricing
    uint256 public constant INITIAL_VIRTUAL_TOKEN_RESERVES = 1_073_000_000e18;

    /// @notice Real tokens available for bonding curve sales
    uint256 public constant INITIAL_REAL_TOKEN_RESERVES = 793_100_000e18;

    /// @notice Tokens reserved for Uniswap V2 liquidity
    uint256 public constant RESERVED_FOR_DEX = 206_900_000e18;

    /// @notice Trading fee in basis points (1% = 100 bps)
    uint256 public constant FEE_BPS = 100;

    /// @notice Basis points denominator
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /* ========== STATE VARIABLES ========== */

    /// @notice Token name (storage for proxy pattern)
    string private _tokenName;

    /// @notice Token symbol (storage for proxy pattern)
    string private _tokenSymbol;

    /// @notice Address of the base trading asset (e.g., WcBTC, WETH)
    address public baseAsset;

    /// @notice Factory contract that deployed this token
    address public factory;

    /// @notice Uniswap V2 Router for graduation
    IUniswapV2Router02 public uniswapV2Router;

    /// @notice Address that receives protocol fees at graduation
    address public feeRecipient;

    /// @notice Virtual token reserves (used for pricing calculations)
    uint256 public virtualTokenReserves;

    /// @notice Virtual base asset reserves (used for pricing calculations)
    uint256 public virtualBaseReserves;

    /// @notice Real token reserves (actual tokens available for sale)
    uint256 public realTokenReserves;

    /// @notice Real base asset reserves (actual base collected from buys)
    uint256 public realBaseReserves;

    /// @notice Whether the token has graduated to Uniswap V2
    bool public graduated;

    /// @notice Whether the token is ready for graduation (bonding curve complete)
    bool public canGraduate;

    /// @notice Uniswap V2 pair address (set after graduation)
    address public v2Pair;

    /// @notice Pre-computed Uniswap V2 pair address (for front-running protection)
    address public uniswapPair;

    /* ========== EVENTS ========== */

    /**
     * @notice Emitted when tokens are bought from the bonding curve
     * @param buyer Address of the buyer
     * @param baseIn Amount of base asset spent
     * @param tokensOut Amount of tokens received
     * @param virtualTokenReserves New virtual token reserves
     * @param virtualBaseReserves New virtual base reserves
     */
    event Buy(
        address indexed buyer,
        uint256 baseIn,
        uint256 tokensOut,
        uint256 virtualTokenReserves,
        uint256 virtualBaseReserves
    );

    /**
     * @notice Emitted when tokens are sold to the bonding curve
     * @param seller Address of the seller
     * @param tokensIn Amount of tokens sold
     * @param baseOut Amount of base asset received
     * @param virtualTokenReserves New virtual token reserves
     * @param virtualBaseReserves New virtual base reserves
     */
    event Sell(
        address indexed seller,
        uint256 tokensIn,
        uint256 baseOut,
        uint256 virtualTokenReserves,
        uint256 virtualBaseReserves
    );

    /**
     * @notice Emitted when token graduates to Uniswap V2
     * @param pair Address of the Uniswap V2 pair
     * @param liquidityLocked Amount of base asset locked in V2
     * @param protocolFees Amount of fees sent to protocol treasury
     */
    event Graduated(address indexed pair, uint256 liquidityLocked, uint256 protocolFees);

    /**
     * @notice Emitted when bonding curve is complete and token is ready for graduation
     */
    event ReadyForGraduation();

    /* ========== ERRORS ========== */

    error AlreadyInitialized();
    error InvalidFactory();
    error InvalidBaseAsset();
    error InvalidRouter();
    error InvalidFeeRecipient();
    error InvalidVirtualBaseReserves();
    error ZeroAmount();
    error InsufficientOutput();
    error InsufficientInput();
    error AlreadyGraduated();
    error MustGraduateFirst();
    error NotReadyForGraduation();
    error BondingCurveNotComplete();
    error NotGraduated();
    error TransferFailed();
    error InsufficientReserves();
    error TransferToUniswapPairBlocked();
    error InvalidInitCodeHash();

    /* ========== INITIALIZATION ========== */

    /**
     * @notice Constructor (called only once for implementation contract)
     * @dev Actual initialization happens in initialize()
     */
    constructor() ERC20("Implementation", "IMPL") Ownable(msg.sender) {
        // Disable initialization of implementation contract
        factory = address(1);
    }

    /**
     * @notice Initializes a new bonding curve token (called by factory for each clone)
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param baseAsset_ Address of the base trading asset
     * @param factory_ Address of the factory contract
     * @param uniswapV2Router_ Address of Uniswap V2 Router
     * @param feeRecipient_ Address that receives protocol fees at graduation
     * @param initialVirtualBase_ Initial virtual base reserves for pricing
     * @param initCodeHash_ Init code hash for Uniswap V2 pair address computation
     */
    function initialize(
        string memory name_,
        string memory symbol_,
        address baseAsset_,
        address factory_,
        address uniswapV2Router_,
        address feeRecipient_,
        uint256 initialVirtualBase_,
        bytes32 initCodeHash_
    ) external {
        // Prevent re-initialization (factory is set to address(1) in implementation constructor)
        if (factory != address(0)) revert AlreadyInitialized();
        if (factory_ == address(0)) revert InvalidFactory();
        if (baseAsset_ == address(0)) revert InvalidBaseAsset();
        if (uniswapV2Router_ == address(0)) revert InvalidRouter();
        if (feeRecipient_ == address(0)) revert InvalidFeeRecipient();
        if (initialVirtualBase_ == 0) revert InvalidVirtualBaseReserves();
        if (initCodeHash_ == bytes32(0)) revert InvalidInitCodeHash();

        // Set state variables
        factory = factory_;
        baseAsset = baseAsset_;
        uniswapV2Router = IUniswapV2Router02(uniswapV2Router_);
        feeRecipient = feeRecipient_;

        // Set name and symbol
        _tokenName = name_;
        _tokenSymbol = symbol_;

        // Compute Uniswap V2 pair address deterministically (for front-running protection)
        address v2Factory = IUniswapV2Router02(uniswapV2Router_).factory();
        (address token0, address token1) = address(this) < baseAsset_
            ? (address(this), baseAsset_)
            : (baseAsset_, address(this));
        uniswapPair = address(uint160(uint256(keccak256(abi.encodePacked(
            hex'ff',
            v2Factory,
            keccak256(abi.encodePacked(token0, token1)),
            initCodeHash_
        )))));

        // Initialize reserves
        virtualTokenReserves = INITIAL_VIRTUAL_TOKEN_RESERVES;
        virtualBaseReserves = initialVirtualBase_;
        realTokenReserves = INITIAL_REAL_TOKEN_RESERVES;
        realBaseReserves = 0;

        // Mint total supply to this contract
        _mint(address(this), TOTAL_SUPPLY);

        // Transfer ownership to factory owner (for emergency pause)
        _transferOwnership(Ownable(factory_).owner());
    }

    /* ========== EXTERNAL FUNCTIONS - TRADING ========== */

    /**
     * @notice Buy tokens from the bonding curve
     * @param baseIn Amount of base asset to spend
     * @param minTokensOut Minimum tokens to receive (slippage protection)
     * @return tokensOut Amount of tokens received
     */
    function buy(uint256 baseIn, uint256 minTokensOut)
        external
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (graduated) revert AlreadyGraduated();
        if (canGraduate) revert MustGraduateFirst();
        if (baseIn == 0) revert ZeroAmount();

        // Calculate tokens out using exact pump.fun formula
        // 1. Deduct 1% fee from input
        uint256 fee = (baseIn * FEE_BPS) / BPS_DENOMINATOR;
        uint256 baseInAfterFee = baseIn - fee;

        // 2. Apply constant product formula: x * y = k
        uint256 newVirtualBaseReserves = virtualBaseReserves + baseInAfterFee;
        uint256 k = virtualBaseReserves * virtualTokenReserves;
        uint256 newVirtualTokenReserves = k / newVirtualBaseReserves;

        // 3. Calculate tokens out
        tokensOut = virtualTokenReserves - newVirtualTokenReserves;

        // 4. Safety cap - cannot exceed real reserves
        if (tokensOut > realTokenReserves) {
            tokensOut = realTokenReserves;
        }

        // 5. Validate slippage protection
        if (tokensOut < minTokensOut) revert InsufficientOutput();

        // Transfer base asset from buyer (check before effects)
        if (!IERC20(baseAsset).transferFrom(msg.sender, address(this), baseIn)) {
            revert TransferFailed();
        }

        // Update reserves (effects before interactions)
        _updateReserves(
            newVirtualTokenReserves,
            newVirtualBaseReserves,
            -int256(tokensOut),      // Token reserves decrease
            int256(baseInAfterFee)   // Base reserves increase (after fee)
        );

        // Transfer tokens to buyer (interactions last)
        _transfer(address(this), msg.sender, tokensOut);

        // Emit event
        emit Buy(msg.sender, baseIn, tokensOut, virtualTokenReserves, virtualBaseReserves);

        // Check if graduation conditions met
        _checkAndGraduate();
    }

    /**
     * @notice Sell tokens to the bonding curve
     * @param tokensIn Amount of tokens to sell
     * @param minBaseOut Minimum base asset to receive (slippage protection)
     * @return baseOut Amount of base asset received
     */
    function sell(uint256 tokensIn, uint256 minBaseOut)
        external
        nonReentrant
        returns (uint256 baseOut)
    {
        if (graduated) revert AlreadyGraduated();
        if (canGraduate) revert MustGraduateFirst();
        if (tokensIn == 0) revert ZeroAmount();

        // Calculate base out using exact pump.fun formula (inline, no duplicate computation)
        // 1. Apply constant product formula: x * y = k
        uint256 newVirtualTokenReserves = virtualTokenReserves + tokensIn;
        uint256 k = virtualBaseReserves * virtualTokenReserves;
        uint256 newVirtualBaseReserves = k / newVirtualTokenReserves;

        // 2. Calculate base out before fee
        uint256 baseOutBeforeFee = virtualBaseReserves - newVirtualBaseReserves;

        // 3. Deduct 1% fee from output
        uint256 fee = (baseOutBeforeFee * FEE_BPS) / BPS_DENOMINATOR;
        baseOut = baseOutBeforeFee - fee;

        // 4. Safety cap - cannot exceed real reserves
        if (baseOut > realBaseReserves) {
            baseOut = realBaseReserves;
        }

        // 5. Validate slippage protection
        if (baseOut < minBaseOut) revert InsufficientOutput();

        // Transfer tokens from seller (check before effects)
        _transfer(msg.sender, address(this), tokensIn);

        // Update reserves (effects before interactions)
        _updateReserves(
            newVirtualTokenReserves,
            newVirtualBaseReserves,
            int256(tokensIn),    // Token reserves increase
            -int256(baseOut)     // Base reserves decrease
        );

        // Transfer base asset to seller (interactions last)
        if (!IERC20(baseAsset).transfer(msg.sender, baseOut)) {
            revert TransferFailed();
        }

        // Emit event
        emit Sell(msg.sender, tokensIn, baseOut, virtualTokenReserves, virtualBaseReserves);
    }

    /* ========== PUBLIC FUNCTIONS - CALCULATIONS ========== */

    /**
     * @notice Calculate tokens received for a given base asset input
     * @param baseIn Amount of base asset to spend
     * @return tokensOut Amount of tokens that would be received
     */
    function calculateBuy(uint256 baseIn)
        public
        view
        returns (uint256 tokensOut)
    {
        if (baseIn == 0) return 0;

        // 1. Deduct 1% fee from input (pump.fun exact formula)
        uint256 fee = (baseIn * FEE_BPS) / BPS_DENOMINATOR;
        uint256 baseInAfterFee = baseIn - fee;

        // 2. Apply constant product formula: x * y = k
        uint256 newVirtualBaseReserves = virtualBaseReserves + baseInAfterFee;
        uint256 k = virtualBaseReserves * virtualTokenReserves;
        uint256 newVirtualTokenReserves = k / newVirtualBaseReserves;

        // 3. Calculate tokens out
        tokensOut = virtualTokenReserves - newVirtualTokenReserves;

        // 4. Cannot exceed real reserves (safety cap)
        if (tokensOut > realTokenReserves) {
            tokensOut = realTokenReserves;
        }
    }

    /**
     * @notice Calculate base asset received for selling tokens
     * @param tokensIn Amount of tokens to sell
     * @return baseOut Amount of base asset that would be received
     */
    function calculateSell(uint256 tokensIn)
        public
        view
        returns (uint256 baseOut)
    {
        if (tokensIn == 0) return 0;

        // 1. Apply constant product formula: x * y = k
        uint256 newVirtualTokenReserves = virtualTokenReserves + tokensIn;
        uint256 k = virtualBaseReserves * virtualTokenReserves;
        uint256 newVirtualBaseReserves = k / newVirtualTokenReserves;

        // 2. Calculate base out before fee (pump.fun exact formula)
        uint256 baseOutBeforeFee = virtualBaseReserves - newVirtualBaseReserves;

        // 3. Deduct 1% fee from output
        uint256 fee = (baseOutBeforeFee * FEE_BPS) / BPS_DENOMINATOR;
        baseOut = baseOutBeforeFee - fee;

        // 4. Cannot exceed real reserves (safety cap)
        if (baseOut > realBaseReserves) {
            baseOut = realBaseReserves;
        }
    }

    /**
     * @notice Get current bonding curve progress (0-100%)
     * @return progress Percentage of tokens sold (basis points)
     */
    function getBondingCurveProgress() public view returns (uint256 progress) {
        if (graduated) return BPS_DENOMINATOR; // 100%
        
        uint256 tokensSold = INITIAL_REAL_TOKEN_RESERVES - realTokenReserves;
        progress = (tokensSold * BPS_DENOMINATOR) / INITIAL_REAL_TOKEN_RESERVES;
    }

    /**
     * @notice Get current reserves
     * @return virtualToken Virtual token reserves
     * @return virtualBase Virtual base reserves
     * @return realToken Real token reserves
     * @return realBase Real base reserves
     */
    function getReserves()
        external
        view
        returns (
            uint256 virtualToken,
            uint256 virtualBase,
            uint256 realToken,
            uint256 realBase
        )
    {
        return (
            virtualTokenReserves,
            virtualBaseReserves,
            realTokenReserves,
            realBaseReserves
        );
    }

    /**
     * @notice Returns the name of the token
     * @return Token name
     */
    function name() public view override returns (string memory) {
        return _tokenName;
    }

    /**
     * @notice Returns the symbol of the token
     * @return Token symbol
     */
    function symbol() public view override returns (string memory) {
        return _tokenSymbol;
    }

    /**
     * @notice Returns the metadata URI for this token
     * @dev Queries factory contract for metadata, enables token self-awareness
     * @return URI pointing to token metadata JSON (IPFS/Arweave/HTTPS)
     */
    function metadataURI() external view returns (string memory) {
        (, , , , string memory uri) = ITokenFactory(factory).getTokenInfo(address(this));
        return uri;
    }

    /* ========== INTERNAL FUNCTIONS ========== */

    /**
     * @notice ERC20 transfer hook - blocks transfers to Uniswap pair before graduation
     * @dev Prevents front-running attacks that could DoS graduation by seeding the pair with wrong ratio
     * @param from Address tokens are transferred from
     * @param to Address tokens are transferred to
     * @param value Amount of tokens transferred
     */
    function _update(address from, address to, uint256 value) internal override {
        if (!graduated && to == uniswapPair) {
            revert TransferToUniswapPairBlocked();
        }
        super._update(from, to, value);
    }

    /**
     * @notice Update reserves after a trade
     * @param newVirtualTokenReserves New virtual token reserves
     * @param newVirtualBaseReserves New virtual base reserves
     * @param tokenDelta Change in real token reserves (negative for buy, positive for sell)
     * @param baseDelta Change in real base reserves (positive for buy, negative for sell)
     */
    function _updateReserves(
        uint256 newVirtualTokenReserves,
        uint256 newVirtualBaseReserves,
        int256 tokenDelta,
        int256 baseDelta
    ) internal {
        // Update virtual reserves (used for pricing)
        virtualTokenReserves = newVirtualTokenReserves;
        virtualBaseReserves = newVirtualBaseReserves;

        // Update real reserves (actual balances)
        if (tokenDelta < 0) {
            realTokenReserves -= uint256(-tokenDelta);
        } else {
            realTokenReserves += uint256(tokenDelta);
        }

        if (baseDelta < 0) {
            realBaseReserves -= uint256(-baseDelta);
        } else {
            // Note: Assumes 1:1 transfer. If baseAsset has fees-on-transfer, this value
            // will drift higher than the actual contract balance, breaking graduation!
            realBaseReserves += uint256(baseDelta);
        }
    }

    /* ========== INTERNAL FUNCTIONS - GRADUATION ========== */

    /**
     * @notice Check if graduation conditions are met and set flag
     */
    function _checkAndGraduate() internal {
        if (!graduated && !canGraduate && realTokenReserves == 0) {
            canGraduate = true;
            emit ReadyForGraduation();
        }
    }

    /* ========== EXTERNAL FUNCTIONS - GRADUATION ========== */

    /**
     * @notice Graduate token to Uniswap V2 (permissionless, callable by anyone)
     * @dev Can only be called when bonding curve is complete (realTokenReserves == 0)
     */
    function graduate() external nonReentrant {
        // Validate graduation conditions (check graduated first for correct error message)
        if (graduated) revert AlreadyGraduated();
        if (!canGraduate) revert NotReadyForGraduation();
        if (realTokenReserves != 0) revert BondingCurveNotComplete();

        // Mark as graduated
        graduated = true;
        canGraduate = false;

        // Calculate accumulated protocol fees (1% of all trades)
        uint256 contractBalance = IERC20(baseAsset).balanceOf(address(this));
        uint256 accumulatedFees = contractBalance - realBaseReserves;

        // Send protocol fees to fee recipient (before adding liquidity for check-effects-interactions)
        if (accumulatedFees > 0) {
            if (!IERC20(baseAsset).transfer(feeRecipient, accumulatedFees)) {
                revert TransferFailed();
            }
        }

        // Get router and factory addresses
        IUniswapV2Router02 router = uniswapV2Router;
        IUniswapV2Factory v2Factory = IUniswapV2Factory(router.factory());

        // Create pair if it doesn't exist, or get existing pair
        v2Pair = v2Factory.getPair(address(this), baseAsset);
        if (v2Pair == address(0)) {
            v2Pair = v2Factory.createPair(address(this), baseAsset);
        }

        // Approve router to spend tokens and base asset
        _approve(address(this), address(router), RESERVED_FOR_DEX);
        IERC20(baseAsset).approve(address(router), realBaseReserves);

        // Add liquidity to Uniswap V2 (only realBaseReserves, fees already sent)
        // Using addLiquidity (not addLiquidityETH) since baseAsset is ERC20
        (,, uint256 lpTokens) = router.addLiquidity(
            address(this),          // tokenA (this token)
            baseAsset,              // tokenB (base asset - JUSD)
            RESERVED_FOR_DEX,       // amountADesired (206.9M tokens)
            realBaseReserves,       // amountBDesired (~12,750 JUSD collected at graduation)
            RESERVED_FOR_DEX,       // amountAMin (no slippage - first LP)
            realBaseReserves,       // amountBMin (no slippage - first LP)
            address(this),          // LP tokens to this contract
            block.timestamp         // deadline (now)
        );

        // Burn LP tokens to dead address (permanent lock)
        IERC20(v2Pair).transfer(
            address(0x000000000000000000000000000000000000dEaD),
            lpTokens
        );

        // Emit graduation event with fees
        emit Graduated(v2Pair, realBaseReserves, accumulatedFees);
    }

}
