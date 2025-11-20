// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IUniswapV2Pair {
    function mint(address to, uint256 amount) external;
}

/**
 * @title MockUniswapV2Router
 * @notice Mock Uniswap V2 Router for testing
 */
contract MockUniswapV2Router {
    address public factory;
    address public WETH;

    constructor(address _factory, address _WETH) {
        factory = _factory;
        WETH = _WETH;
    }

    function setFactory(address _factory) external {
        factory = _factory;
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    )
        external
        returns (
            uint256 amountA,
            uint256 amountB,
            uint256 liquidity
        )
    {
        // Transfer tokens from sender to this contract (mock LP)
        IERC20(tokenA).transferFrom(msg.sender, address(this), amountADesired);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountBDesired);

        // Mock LP tokens amount (just use the smaller amount)
        liquidity = amountADesired < amountBDesired ? amountADesired : amountBDesired;

        // Get the pair from factory and mint LP tokens to recipient
        if (factory != address(0)) {
            address pair = IUniswapV2Factory(factory).getPair(tokenA, tokenB);
            if (pair != address(0)) {
                IUniswapV2Pair(pair).mint(to, liquidity);
            }
        }

        // Return values
        return (amountADesired, amountBDesired, liquidity);
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    )
        external
        payable
        returns (
            uint256 amountToken,
            uint256 amountETH,
            uint256 liquidity
        )
    {
        // Mock implementation - just return some values
        return (amountTokenDesired, msg.value, msg.value);
    }
}
