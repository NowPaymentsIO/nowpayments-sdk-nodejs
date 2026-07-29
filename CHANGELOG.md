# Changelog

## Unreleased

### Fixed

- `getPayoutStatus()` / `watchPayoutStatus()` / `onPayoutStatusChange()` read the requested payout from the `withdrawals` array of `GET /v1/payout/{id}` (matched by id) instead of a nonexistent `payouts` array.
- `listPayouts({ status })` now only accepts the six statuses `GET /v1/payout` supports as a filter (`creating`, `waiting`, `processing`, `finished`, `failed`, `rejected`); the previously-allowed `new`, `sending`, `rejected_not_checked`, `cancelled`/`canceled` returned a 400 from the live API and are rejected client-side instead.
- `createPayout()` no longer sends `payout_description` at the root of `POST /v1/payout`; the live API rejects it there with `INVALID_REQUEST_PARAMS: payout_description is not allowed`. A batch-level `payoutDescription` is now copied onto every withdrawal that doesn't set its own.

## 0.3.0

### Added

- Full high-level and raw-client coverage for NOWPayments Mass payouts.
- Simplified single-payout and batch creation through `createPayout()`.
- Automatic payout preflight for available balance, withdrawal minimum and estimated network fee.
- Automatic JWT acquisition/refresh for Bearer-protected payout creation and verification.
- Built-in RFC 6238 TOTP generation with no runtime dependency.
- Automatic 2FA verification when `twoFactorSecret` or `twoFactorCodeProvider` is configured.
- Explicit manual verification flow through `verifyPayout()` when no 2FA secret is configured.
- Payout status normalization, listing and polling helpers analogous to payment status helpers.
- Raw payout statuses `new` and `rejected_not_checked` are accepted and normalized.
- Address validation, payout balance, fee estimate and minimum-withdrawal helpers.
- TypeScript declarations, examples and tests for Mass payouts.
- Guarded live integration suites for read-only checks, automatic 2FA, manual 2FA and raw-client payout flows.

### Compatibility

- Existing payment, checkout, webhook, authentication and payment-status APIs are unchanged.
