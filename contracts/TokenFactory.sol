// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "./BondingCurveToken.sol";
import "./interfaces/IPermit2.sol";

/**
 * @title TokenFactory
 * @notice Factory contract for deploying bonding curve tokens using minimal proxies (EIP-1167)
 * @dev Uses OpenZeppelin Clones library for gas-efficient token deployment
 */
contract TokenFactory is Ownable, Pausable, ReentrancyGuard {
    using Clones for address;

    /* ========== CONSTANTS ========== */

    /// @notice Maximum allowed length for token name
    uint256 public constant MAX_NAME_LENGTH = 100;

    /// @notice Maximum allowed length for token symbol
    uint256 public constant MAX_SYMBOL_LENGTH = 20;

    /// @notice Maximum allowed length for metadata URI (1KB limit)
    uint256 public constant MAX_METADATA_URI_LENGTH = 1024;

    /* ========== STATE VARIABLES ========== */

    /// @notice Implementation contract address for all bonding curve tokens
    address public immutable implementation;

    /// @notice Uniswap V2 Router address for graduation
    address public immutable uniswapV2Router;

    /// @notice Base asset that all tokens will trade against (e.g., JUSD)
    /// @dev NOTE: If a fee-on-transfer token is used, graduation will revert due to reserve mismatch.
    address public immutable baseAsset;

    /// @notice Permit2 contract used for signature-based dev-buy funding
    IPermit2 public immutable permit2;

    /// @notice Init code hash for Uniswap V2 pair address computation (chain-specific)
    bytes32 public immutable initCodeHash;

    /// @notice Address that receives protocol fees from token graduations
    address public feeRecipient;

    /// @notice Initial virtual base reserves for all new tokens (configurable)
    uint256 public initialVirtualBaseReserves;

    /// @notice Array of all deployed token addresses
    address[] public allTokens;

    /// @notice Mapping from token address to deployment info
    mapping(address => TokenInfo) public tokenInfo;

    /* ========== STRUCTS ========== */

    /**
     * @notice Information about each deployed token
     * @param creator Address that created the token
     * @param timestamp Block timestamp when token was created (uint96 for gas optimization)
     * @param name Token name
     * @param symbol Token symbol
     * @param metadataURI URI pointing to token metadata JSON (IPFS/Arweave/HTTPS)
     */
    struct TokenInfo {
        address creator;      // 20 bytes
        uint96 timestamp;     // 12 bytes (packed with creator in slot 0)
        string name;          // dynamic
        string symbol;        // dynamic
        string metadataURI;   // dynamic
    }

    /* ========== EVENTS ========== */

    /**
     * @notice Emitted when a new token is created
     * @param token Address of the newly created token
     * @param creator Address of the token creator
     * @param name Token name
     * @param symbol Token symbol
     * @param baseAsset Address of the base asset (e.g., WcBTC)
     * @param initialVirtualBaseReserves Initial virtual base reserves for bonding curve
     * @param feeRecipient Address that will receive protocol fees at graduation
     * @param metadataURI URI pointing to token metadata JSON
     */
    event TokenCreated(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        address baseAsset,
        uint256 initialVirtualBaseReserves,
        address feeRecipient,
        string metadataURI
    );

    /**
     * @notice Emitted when fee recipient is updated
     * @param oldRecipient Previous fee recipient address
     * @param newRecipient New fee recipient address
     */
    event FeeRecipientUpdated(
        address indexed oldRecipient,
        address indexed newRecipient
    );

    /**
     * @notice Emitted when initial virtual base reserves setting is updated
     * @param oldValue Previous value
     * @param newValue New value
     */
    event InitialVirtualBaseReservesUpdated(
        uint256 oldValue,
        uint256 newValue
    );

    /**
     * @notice Emitted when a creator's atomically bundled dev buy is executed
     * @param token Address of the newly created token
     * @param creator Address of the token creator and dev-buy recipient
     * @param baseIn Amount of base asset spent
     * @param tokensOut Amount of launchpad tokens received
     */
    event DevBuyExecuted(
        address indexed token,
        address indexed creator,
        uint256 baseIn,
        uint256 tokensOut
    );

    /* ========== ERRORS ========== */

    error InvalidImplementation();
    error InvalidRouter();
    error InvalidBaseAsset();
    error InvalidPermit2();
    error InvalidFeeRecipient();
    error InvalidVirtualBaseReserves();
    error InvalidInitCodeHash();
    error InvalidName();
    error InvalidSymbol();
    error InvalidMetadataURI();
    error NameTooLong();
    error SymbolTooLong();
    error MetadataURITooLong();
    error InvalidControlCharacter();
    error InvalidSymbolCharacter();
    error InvalidDevBuyAmount();
    error DevBuyAmountTooLarge();
    error PermitTokenMismatch();
    error PermitSpenderMismatch();
    error PermitAmountTooLow();
    error PermitExpired();
    error InvalidDevBuyFunding();

    /* ========== CONSTRUCTOR ========== */

    /**
     * @notice Initializes the factory with implementation, router, base asset, and fee recipient addresses
     * @param _implementation Address of the BondingCurveToken implementation
     * @param _uniswapV2Router Address of Uniswap V2 Router for graduation
     * @param _baseAsset Address of the base asset all tokens will trade against (e.g., JUSD)
     * @param _permit2 Address of Permit2 for signature-based dev-buy funding
     * @param _feeRecipient Address that receives protocol fees from token graduations
     * @param _initialVirtualBaseReserves Initial virtual base reserves for pricing (must be > 0)
     * @param _initCodeHash Init code hash for Uniswap V2 pair address computation
     */
    constructor(
        address _implementation,
        address _uniswapV2Router,
        address _baseAsset,
        address _permit2,
        address _feeRecipient,
        uint256 _initialVirtualBaseReserves,
        bytes32 _initCodeHash
    ) Ownable(msg.sender) {
        if (_implementation == address(0)) revert InvalidImplementation();
        if (_uniswapV2Router == address(0)) revert InvalidRouter();
        if (_baseAsset == address(0)) revert InvalidBaseAsset();
        if (_permit2 == address(0)) revert InvalidPermit2();
        if (_feeRecipient == address(0)) revert InvalidFeeRecipient();
        if (_initialVirtualBaseReserves == 0) revert InvalidVirtualBaseReserves();
        if (_initCodeHash == bytes32(0)) revert InvalidInitCodeHash();

        implementation = _implementation;
        uniswapV2Router = _uniswapV2Router;
        baseAsset = _baseAsset;
        permit2 = IPermit2(_permit2);
        feeRecipient = _feeRecipient;
        initialVirtualBaseReserves = _initialVirtualBaseReserves;
        initCodeHash = _initCodeHash;
    }

    /* ========== INTERNAL FUNCTIONS ========== */

    /**
     * @notice Validates that a string contains no ASCII control characters
     * @dev Rejects ALL C0 control characters (0x00-0x1F) and DEL (0x7F)
     * @dev Prevents: null byte injection, newlines, terminal escapes, tab spoofing
     * @dev Allows: Unicode characters (emoji, international text)
     * @param str String to validate (name or metadataURI)
     */
    function _validatePrintableString(string memory str) private pure {
        bytes memory b = bytes(str);
        uint256 len = b.length;
        for (uint256 i = 0; i < len; ) {
            uint8 c = uint8(b[i]);
            // Reject C0 control characters (0x00-0x1F) and DEL (0x7F)
            if (c < 0x20 || c == 0x7F) {
                revert InvalidControlCharacter();
            }
            unchecked { ++i; }
        }
    }

    /**
     * @notice Validates that a symbol contains only uppercase alphanumeric ASCII
     * @dev Only allows A-Z (0x41-0x5A) and 0-9 (0x30-0x39)
     * @dev Follows industry standard: BTC, ETH, USDT, etc.
     * @param str Symbol string to validate
     */
    function _validateSymbol(string memory str) private pure {
        bytes memory b = bytes(str);
        uint256 len = b.length;
        for (uint256 i = 0; i < len; ) {
            uint8 c = uint8(b[i]);
            // Allow only A-Z (0x41-0x5A) and 0-9 (0x30-0x39)
            bool isUpperAlpha = (c >= 0x41 && c <= 0x5A);
            bool isDigit = (c >= 0x30 && c <= 0x39);
            if (!isUpperAlpha && !isDigit) {
                revert InvalidSymbolCharacter();
            }
            unchecked { ++i; }
        }
    }

    function _validateTokenInputs(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI
    ) private pure {
        // Validate name
        if (bytes(name).length == 0) revert InvalidName();
        if (bytes(name).length > MAX_NAME_LENGTH) revert NameTooLong();
        _validatePrintableString(name);

        // Validate symbol (strict: A-Z, 0-9 only)
        if (bytes(symbol).length == 0) revert InvalidSymbol();
        if (bytes(symbol).length > MAX_SYMBOL_LENGTH) revert SymbolTooLong();
        _validateSymbol(symbol);

        // Validate metadata URI
        if (bytes(metadataURI).length == 0) revert InvalidMetadataURI();
        if (bytes(metadataURI).length > MAX_METADATA_URI_LENGTH) revert MetadataURITooLong();
        _validatePrintableString(metadataURI);
    }

    function _deployValidatedToken(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address creator
    ) private returns (address token) {
        // Clone the implementation contract using EIP-1167 minimal proxy
        token = implementation.clone();

        // Initialize the cloned contract with factory's base asset and fee recipient
        BondingCurveToken(token).initialize(
            name,
            symbol,
            baseAsset,
            address(this),
            uniswapV2Router,
            feeRecipient,
            initialVirtualBaseReserves,
            initCodeHash
        );

        // Store token information
        tokenInfo[token] = TokenInfo({
            creator: creator,
            timestamp: uint96(block.timestamp),
            name: name,
            symbol: symbol,
            metadataURI: metadataURI
        });

        // Add to tokens array
        allTokens.push(token);

        // Emit event with complete deployment configuration
        emit TokenCreated(
            token,
            creator,
            name,
            symbol,
            baseAsset,
            initialVirtualBaseReserves,
            feeRecipient,
            metadataURI
        );
    }

    function _validateDevBuyPermit(
        IPermit2.PermitSingle calldata permitSingle,
        uint256 devBuyBaseIn
    ) private view {
        if (devBuyBaseIn == 0) revert InvalidDevBuyAmount();
        if (devBuyBaseIn > type(uint160).max) revert DevBuyAmountTooLarge();
        if (permitSingle.details.token != baseAsset) revert PermitTokenMismatch();
        if (permitSingle.spender != address(this)) revert PermitSpenderMismatch();
        if (permitSingle.details.amount < devBuyBaseIn) revert PermitAmountTooLow();
        if (permitSingle.details.expiration < block.timestamp || permitSingle.sigDeadline < block.timestamp) {
            revert PermitExpired();
        }
    }

    /* ========== EXTERNAL FUNCTIONS ========== */

    /**
     * @notice Creates a new bonding curve token using minimal proxy pattern
     * @dev All tokens trade against the factory's base asset (set at deployment)
     * @dev SECURITY: Enforces max lengths - name (100), symbol (20), metadataURI (1024 bytes)
     * @dev SECURITY: Name/URI reject control chars (0x00-0x1F) and DEL (0x7F), allow Unicode
     * @dev SECURITY: Symbol restricted to uppercase ASCII alphanumeric only (A-Z, 0-9)
     * @param name Name of the token (max 100 chars, allows Unicode, no control chars)
     * @param symbol Symbol of the token (max 20 chars, A-Z and 0-9 only)
     * @param metadataURI URI pointing to token metadata JSON (max 1024 bytes, no control chars)
     * @return token Address of the newly created token
     */
    function createToken(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI
    ) external whenNotPaused nonReentrant returns (address token) {
        _validateTokenInputs(name, symbol, metadataURI);
        token = _deployValidatedToken(name, symbol, metadataURI, msg.sender);
        BondingCurveToken(token).finalizeLaunch();
    }

    /**
     * @notice Creates a new bonding curve token and executes the creator's optional dev buy atomically
     * @dev Uses Permit2 AllowanceTransfer so creator signs a permit for the factory, then the factory
     *      transfers JUSD directly into the newly created token and executes the buy before launch finalization.
     * @param name Name of the token (max 100 chars, allows Unicode, no control chars)
     * @param symbol Symbol of the token (max 20 chars, A-Z and 0-9 only)
     * @param metadataURI URI pointing to token metadata JSON (max 1024 bytes, no control chars)
     * @param devBuyBaseIn Amount of base asset to spend on the creator buy
     * @param minTokensOut Minimum tokens to receive (slippage protection)
     * @param permitSingle Permit2 allowance permit authorizing this factory to spend base asset
     * @param signature Creator's Permit2 signature
     * @return token Address of the newly created token
     * @return tokensOut Amount of tokens received by the creator
     */
    function createTokenWithDevBuyPermit(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        uint256 devBuyBaseIn,
        uint256 minTokensOut,
        IPermit2.PermitSingle calldata permitSingle,
        bytes calldata signature
    ) external whenNotPaused nonReentrant returns (address token, uint256 tokensOut) {
        _validateTokenInputs(name, symbol, metadataURI);
        _validateDevBuyPermit(permitSingle, devBuyBaseIn);

        permit2.permit(msg.sender, permitSingle, signature);

        token = _deployValidatedToken(name, symbol, metadataURI, msg.sender);

        uint256 tokenBaseBalanceBefore = IERC20(baseAsset).balanceOf(token);
        permit2.transferFrom(msg.sender, token, uint160(devBuyBaseIn), baseAsset);
        if (IERC20(baseAsset).balanceOf(token) - tokenBaseBalanceBefore != devBuyBaseIn) {
            revert InvalidDevBuyFunding();
        }

        tokensOut = BondingCurveToken(token).factoryDevBuy(msg.sender, devBuyBaseIn, minTokensOut);

        emit DevBuyExecuted(token, msg.sender, devBuyBaseIn, tokensOut);

        BondingCurveToken(token).finalizeLaunch();
    }

    /**
     * @notice Pauses token creation
     * @dev Only owner can pause
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses token creation
     * @dev Only owner can unpause
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Updates the fee recipient address
     * @dev Only owner can update. New tokens will use the updated address.
     * @param _feeRecipient New fee recipient address
     */
    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        if (_feeRecipient == address(0)) revert InvalidFeeRecipient();

        address oldRecipient = feeRecipient;
        feeRecipient = _feeRecipient;

        emit FeeRecipientUpdated(oldRecipient, _feeRecipient);
    }

    /**
     * @notice Updates the initial virtual base reserves for new tokens
     * @dev Only owner can update. Applies only to NEW tokens created after this call.
     * @param _initialVirtualBaseReserves New initial virtual base reserves value (must be > 0)
     */
    function setInitialVirtualBaseReserves(uint256 _initialVirtualBaseReserves) external onlyOwner {
        if (_initialVirtualBaseReserves == 0) revert InvalidVirtualBaseReserves();

        uint256 oldValue = initialVirtualBaseReserves;
        initialVirtualBaseReserves = _initialVirtualBaseReserves;

        emit InitialVirtualBaseReservesUpdated(oldValue, _initialVirtualBaseReserves);
    }

    /* ========== VIEW FUNCTIONS ========== */

    /**
     * @notice Returns the total number of tokens created
     * @return Total number of tokens
     */
    function allTokensLength() external view returns (uint256) {
        return allTokens.length;
    }

    /**
     * @notice Returns token address at specific index
     * @param index Index in the allTokens array
     * @return Token address
     */
    function getToken(uint256 index) external view returns (address) {
        return allTokens[index];
    }

    /**
     * @notice Returns information about a specific token
     * @param token Token address
     * @return creator Address of token creator
     * @return timestamp Creation timestamp (uint96 for gas optimization)
     * @return name Token name
     * @return symbol Token symbol
     * @return metadataURI URI pointing to token metadata JSON
     */
    function getTokenInfo(address token)
        external
        view
        returns (
            address creator,
            uint96 timestamp,
            string memory name,
            string memory symbol,
            string memory metadataURI
        )
    {
        TokenInfo memory info = tokenInfo[token];
        return (info.creator, info.timestamp, info.name, info.symbol, info.metadataURI);
    }
}
