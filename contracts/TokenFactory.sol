// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "./BondingCurveToken.sol";

/**
 * @title TokenFactory
 * @notice Factory contract for deploying bonding curve tokens using minimal proxies (EIP-1167)
 * @dev Uses OpenZeppelin Clones library for gas-efficient token deployment
 */
contract TokenFactory is Ownable, Pausable {
    using Clones for address;

    /* ========== STATE VARIABLES ========== */

    /// @notice Implementation contract address for all bonding curve tokens
    address public immutable implementation;

    /// @notice Uniswap V2 Router address for graduation
    address public immutable uniswapV2Router;

    /// @notice Base asset that all tokens will trade against (e.g., JUSD)
    address public immutable baseAsset;

    /// @notice Address that receives protocol fees from token graduations
    address public feeRecipient;

    /// @notice Array of all deployed token addresses
    address[] public allTokens;

    /// @notice Mapping from token address to deployment info
    mapping(address => TokenInfo) public tokenInfo;

    /* ========== STRUCTS ========== */

    /**
     * @notice Information about each deployed token
     * @param creator Address that created the token
     * @param timestamp Block timestamp when token was created
     * @param name Token name
     * @param symbol Token symbol
     */
    struct TokenInfo {
        address creator;
        uint256 timestamp;
        string name;
        string symbol;
    }

    /* ========== EVENTS ========== */

    /**
     * @notice Emitted when a new token is created
     * @param token Address of the newly created token
     * @param creator Address of the token creator
     * @param name Token name
     * @param symbol Token symbol
     * @param baseAsset Address of the base asset (e.g., WcBTC)
     */
    event TokenCreated(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        address baseAsset
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

    /* ========== ERRORS ========== */

    error InvalidImplementation();
    error InvalidRouter();
    error InvalidBaseAsset();
    error InvalidFeeRecipient();
    error InvalidName();
    error InvalidSymbol();

    /* ========== CONSTRUCTOR ========== */

    /**
     * @notice Initializes the factory with implementation, router, base asset, and fee recipient addresses
     * @param _implementation Address of the BondingCurveToken implementation
     * @param _uniswapV2Router Address of Uniswap V2 Router for graduation
     * @param _baseAsset Address of the base asset all tokens will trade against (e.g., JUSD)
     * @param _feeRecipient Address that receives protocol fees from token graduations
     */
    constructor(
        address _implementation,
        address _uniswapV2Router,
        address _baseAsset,
        address _feeRecipient
    ) Ownable(msg.sender) {
        if (_implementation == address(0)) revert InvalidImplementation();
        if (_uniswapV2Router == address(0)) revert InvalidRouter();
        if (_baseAsset == address(0)) revert InvalidBaseAsset();
        if (_feeRecipient == address(0)) revert InvalidFeeRecipient();

        implementation = _implementation;
        uniswapV2Router = _uniswapV2Router;
        baseAsset = _baseAsset;
        feeRecipient = _feeRecipient;
    }

    /* ========== EXTERNAL FUNCTIONS ========== */

    /**
     * @notice Creates a new bonding curve token using minimal proxy pattern
     * @dev All tokens trade against the factory's base asset (set at deployment)
     * @param name Name of the token
     * @param symbol Symbol of the token
     * @return token Address of the newly created token
     */
    function createToken(
        string memory name,
        string memory symbol
    ) external whenNotPaused returns (address token) {
        // Validate inputs
        if (bytes(name).length == 0) revert InvalidName();
        if (bytes(symbol).length == 0) revert InvalidSymbol();

        // Clone the implementation contract using EIP-1167 minimal proxy
        token = implementation.clone();

        // Initialize the cloned contract with factory's base asset and fee recipient
        BondingCurveToken(token).initialize(
            name,
            symbol,
            baseAsset,
            address(this),
            uniswapV2Router,
            feeRecipient
        );

        // Store token information
        tokenInfo[token] = TokenInfo({
            creator: msg.sender,
            timestamp: block.timestamp,
            name: name,
            symbol: symbol
        });

        // Add to tokens array
        allTokens.push(token);

        // Emit event
        emit TokenCreated(token, msg.sender, name, symbol, baseAsset);
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
     * @return timestamp Creation timestamp
     * @return name Token name
     * @return symbol Token symbol
     */
    function getTokenInfo(address token)
        external
        view
        returns (
            address creator,
            uint256 timestamp,
            string memory name,
            string memory symbol
        )
    {
        TokenInfo memory info = tokenInfo[token];
        return (info.creator, info.timestamp, info.name, info.symbol);
    }
}
