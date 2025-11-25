// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MockUniswapV2Pair.sol";

/**
 * @title MockUniswapV2Factory
 * @notice Mock Uniswap V2 Factory for testing
 * @dev Uses CREATE2 for deterministic pair addresses (matches real Uniswap V2 behavior)
 */
contract MockUniswapV2Factory {
    /// @notice Init code hash for pair address computation
    /// @dev Computed as keccak256(type(MockUniswapV2Pair).creationCode)
    bytes32 public constant INIT_CODE_PAIR_HASH = keccak256(type(MockUniswapV2Pair).creationCode);

    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256);

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, "IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "ZERO_ADDRESS");
        require(getPair[token0][token1] == address(0), "PAIR_EXISTS");

        // Deploy new pair using CREATE2 for deterministic address
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        MockUniswapV2Pair newPair = new MockUniswapV2Pair{salt: salt}();
        pair = address(newPair);

        // Store pair
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // Populate mapping in the reverse direction
        allPairs.push(pair);

        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }
}
