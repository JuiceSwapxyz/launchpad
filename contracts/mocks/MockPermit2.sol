// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IPermit2.sol";

/**
 * @title MockPermit2
 * @notice Minimal Permit2 mock for factory dev-buy tests.
 * @dev Signature verification is intentionally skipped; allowance and ERC20 transfer behavior are enforced.
 */
contract MockPermit2 is IPermit2 {
    struct Allowance {
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    mapping(address owner => mapping(address token => mapping(address spender => Allowance))) public allowance;

    function permit(address owner, PermitSingle calldata permitSingle, bytes calldata) external {
        require(permitSingle.sigDeadline >= block.timestamp, "SIG_DEADLINE_EXPIRED");
        require(permitSingle.details.expiration >= block.timestamp, "PERMIT_EXPIRED");

        allowance[owner][permitSingle.details.token][permitSingle.spender] = Allowance({
            amount: permitSingle.details.amount,
            expiration: permitSingle.details.expiration,
            nonce: permitSingle.details.nonce + 1
        });
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        Allowance storage allowed = allowance[from][token][msg.sender];
        require(allowed.expiration >= block.timestamp, "PERMIT_EXPIRED");
        require(allowed.amount >= amount, "PERMIT_AMOUNT_EXCEEDED");

        allowed.amount -= amount;
        require(IERC20(token).transferFrom(from, to, amount), "TRANSFER_FROM_FAILED");
    }
}
