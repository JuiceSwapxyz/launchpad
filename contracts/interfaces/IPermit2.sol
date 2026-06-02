// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @notice Minimal Permit2 AllowanceTransfer interface used by the launchpad factory.
 * @dev Matches Uniswap Permit2's PermitSingle + transferFrom flow.
 */
interface IPermit2 {
    struct PermitDetails {
        address token;
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    struct PermitSingle {
        PermitDetails details;
        address spender;
        uint256 sigDeadline;
    }

    function permit(address owner, PermitSingle calldata permitSingle, bytes calldata signature) external;

    function transferFrom(address from, address to, uint160 amount, address token) external;
}
