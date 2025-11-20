// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUniswapV2Pair
 * @notice Mock Uniswap V2 Pair (LP token) for testing
 */
contract MockUniswapV2Pair is ERC20 {
    constructor() ERC20("Uniswap V2", "UNI-V2") {
        // Mock pair - mint some LP tokens to this contract
        _mint(address(this), 1000000 * 10**18);
    }

    // Mock transfer function that returns LP tokens
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
