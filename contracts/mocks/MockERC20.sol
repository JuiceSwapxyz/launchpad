// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @notice Mock ERC20 token for testing
 */
contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        _mint(msg.sender, 1_000_000 * 10**18); // Mint 1M tokens to deployer
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
