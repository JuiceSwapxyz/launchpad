# Launchpad dev buy — status

Atomic "dev buy" at token creation: the creator seeds their own launch in the
same transaction as `createToken`, funded by a scoped Permit2 allowance.

## State

- **Contract:** `TokenFactory.createTokenWithDevBuyPermit(...)` +
  `_validateDevBuyPermit`, the `DevBuyExecuted` event, Permit2 integration
  (`contracts/interfaces/IPermit2.sol`, `contracts/mocks/MockPermit2.sol`) and
  the `BondingCurveToken` dev-buy path — **complete**.
- **Tests:** suite green — **129 passing, 19 pending, 0 failing** (`npx hardhat test`).
  The 19 pending are network-dependent integration tests (skipped without a live
  node). Covered dev-buy cases include: atomic buy via Permit2, create→buy event
  ordering, the 20% curve-supply cap revert (`DevBuyExceedsMax`) and permit validation.
- **Deployed:** **NO.** The upgraded factory exposing
  `createTokenWithDevBuyPermit` is not yet deployed.

## Known defensive branch (pre-deploy hardening)

`BondingCurveToken.factoryDevBuy` has a `if (devBuyExecuted) revert DevBuyAlreadyExecuted()`
guard with **no direct test** (flagged by Big Brother). It is **unreachable by
construction** through every factory path: `createToken` finalizes immediately, and
`createTokenWithDevBuyPermit` calls `factoryDevBuy` exactly once before finalizing — so
`devBuyExecuted == true && launchFinalized == false` never persists. `initialize` also
calls `Ownable(factory_).owner()`, so the factory cannot be substituted by an EOA. A
direct kill-test therefore needs a bespoke clone harness or storage poke; tracked as a
pre-deploy hardening item rather than forced with a brittle test.

A static-analysis note (`reentrancy-benign` at `TokenFactory.sol` dev-buy funding) is
annotated inline with a justification: the function is `nonReentrant` and only calls the
trusted `permit2`/`baseAsset` immutables, with a strict balance-delta check.

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
