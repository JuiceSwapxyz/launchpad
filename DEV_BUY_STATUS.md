# Launchpad dev buy — status

Atomic "dev buy" at token creation: the creator seeds their own launch in the
same transaction as `createToken`, funded by a scoped Permit2 allowance.

## State

- **Contract:** `TokenFactory.createTokenWithDevBuyPermit(...)` +
  `_validateDevBuyPermit`, the `DevBuyExecuted` event, Permit2 integration
  (`contracts/interfaces/IPermit2.sol`, `contracts/mocks/MockPermit2.sol`) and
  the `BondingCurveToken` dev-buy path — **complete**.
- **Tests:** full suite green — 148 passing, 0 failing
  (`npx hardhat test`), including the "Dev Buy Creation" cases: atomic buy via
  Permit2, create→buy event ordering, the 20% curve-supply cap revert
  (`DevBuyExceedsMax`) and permit validation.
- **Deployed:** **NO.** The upgraded factory exposing
  `createTokenWithDevBuyPermit` is not yet deployed.

## Path to live

1. Audit + deploy the upgraded `TokenFactory` (with Permit2 wired) to Citrea
   testnet, then mainnet.
2. Set the deployed factory address in the bapp env override for each chain:
   `REACT_APP_LAUNCHPAD_5115_FACTORY` (testnet) /
   `REACT_APP_LAUNCHPAD_4114_FACTORY` (mainnet).

Until step 2 is done, the bapp computes `supportsDevBuy = false` and the Create
page renders the Dev buy block disabled with a **"Coming soon"** badge — the dev
buy can never gate or alter token creation. Once a dev-buy factory address is
configured, the UI enables dev buy automatically.
