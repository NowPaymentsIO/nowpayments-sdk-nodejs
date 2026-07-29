# NOWPayments Node.js SDK

Scenario-first SDK for accepting crypto payments and creating mass payouts with NOWPayments from Node.js.

The SDK keeps response bodies close to the NOWPayments API shape, while adding focused high-level flows for hosted checkout, direct payments and payouts. Familiar fields such as `invoice_url`, `payment_id`, `payment_status`, `batch_withdrawal_id` and `payout_status` remain recognizable; non-enumerable camelCase aliases are provided for application code.

## Features

- Node.js >= 18, ESM, no runtime dependencies.
- Hosted checkout flow through `createCheckout()` / `createPayment()`.
- Direct payment flow through `createDirectPayment()` for in-page deposit address UI.
- API-shaped responses with non-enumerable convenience aliases such as `checkout.checkoutUrl` and `payment.id`.
- Stable SDK payment statuses: `pending`, `processing`, `paid`, `partially_paid`, `failed`, `refunded`, `expired`, `cancelled`, `unknown`.
- Payment status polling with `watchPaymentStatus()` and `onPaymentStatusChange()`.
- Mass payout creation through one simple `createPayout()` call for either a single withdrawal or a batch.
- Automatic payout preflight: available balance, minimum withdrawal amount and estimated network fee.
- Built-in TOTP generation and automatic 2FA confirmation when `twoFactorSecret` is configured.
- Manual 2FA flow when no secret is configured, plus payout status polling analogous to payments.
- IPN/webhook signature verification with HMAC SHA-512 and recursively sorted payload keys.
- Consistent `configuration`, `validation`, `network`, `timeout`, `api`, and `unknown` error types.

## Installation

```bash
npm install @nowpaymentsio/nowpayments-sdk-nodejs
```

For local development from this archive:

```bash
npm install /path/to/nowpayments-node-sdk
```

---

## Quick start: hosted checkout

Use this when you want to redirect the customer to the NOWPayments hosted checkout page.

```js
import { NowPaymentsSDK } from '@nowpaymentsio/nowpayments-sdk-nodejs';

const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET,
  ipnCallbackUrl: 'https://example.com/webhooks/nowpayments',
  successUrl: 'https://example.com/payment/success',
  cancelUrl: 'https://example.com/payment/cancel'
});

const checkout = await sdk.createCheckout({
  amount: 49.99,
  currency: 'usd',
  payCurrency: 'btc', // optional — omit to let the customer choose on the invoice page
  orderId: 'order-1001',
  description: 'Demo order'
});

console.log(checkout.id);          // invoice id
console.log(checkout.invoice_url); // redirect customer to this URL
```

`createPayment(input)` and `createHostedCheckout(input)` are aliases for `createCheckout(input)`.

**Checkout is invoice-shaped.** Under the hood, hosted checkout calls `POST /v1/invoice`. The returned object is invoice-shaped — it has `invoice_url` but **no `payment_status`**. A real payment appears only after the customer opens the invoice and sends funds. Track it via IPN/webhook or `watchPaymentStatus()`.

**Preflight when `payCurrency` is set:**

1. `GET /v1/estimate` — converts the price amount to the crypto equivalent
2. `GET /v1/min-amount` — checks the minimum payment amount
3. Throws `ValidationError` with `code: BELOW_MINIMUM_PAYMENT_AMOUNT` if the estimate is below the minimum
4. `POST /v1/invoice`

When `payCurrency` is omitted, all three preflight steps are skipped and only `POST /v1/invoice` is called.

**Example response:**

```js
{
  id: '4522625843',
  order_id: 'order-1001',
  order_description: 'Demo order',
  price_amount: 49.99,
  price_currency: 'usd',
  pay_currency: 'btc',
  ipn_callback_url: 'https://example.com/webhooks/nowpayments',
  invoice_url: 'https://nowpayments.io/payment/?iid=4522625843',
  success_url: 'https://example.com/payment/success',
  cancel_url: 'https://example.com/payment/cancel',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  estimate: { currency_from: 'usd', amount_from: 49.99, currency_to: 'btc', estimated_amount: 0.00042 },
  minimum: { currency_from: 'btc', min_amount: 0.0001 }
}
```

> ⚠️ **Non-enumerable aliases.** Convenience aliases (`id`, `checkoutUrl`, `invoiceUrl`, `amount`, `order`, etc.) are declared **non-enumerable** at runtime. They are accessible by direct property access (`checkout.id`, `checkout.checkoutUrl`), but **do not appear** in `JSON.stringify(checkout)` or `{ ...checkout }`. For serialization use the snake_case fields (`checkout.invoice_url`, `checkout.price_amount`, etc.).

---

## Direct payment flow

Use this when you want to show the deposit address in your own UI instead of redirecting.

```js
const payment = await sdk.createDirectPayment({
  amount: 100,
  currency: 'usd',
  payCurrency: 'trx',
  orderId: 'order-1002',
  ipnCallbackUrl: 'https://example.com/webhooks/nowpayments'
});

console.log(payment.payment_id);   // API field
console.log(payment.id);           // non-enumerable alias
console.log(payment.pay_address);  // deposit address
console.log(payment.deposit.memo); // required for XRP/XLM/MEMO coins
console.log(payment.status);       // SDK status: 'pending'
```

---

## Authentication and automatic JWT refresh

Some NOWPayments endpoints, including `GET /v1/payment/`, payout creation and payout verification, require both `x-api-key` and a Bearer JWT. `POST /v1/auth` returns this JWT from dashboard `email` + `password`; the token is short-lived, so the SDK keeps acquisition, in-memory caching, refresh and one retry after `401 Unauthorized` under the hood.

Pass `apiKey`, `email`, and `password` to one SDK instance. The first Bearer-protected call automatically obtains a JWT, stores it in memory, reuses it while it is valid, and refreshes it when the token is expired or when the API responds with `401 Unauthorized`.

```js
const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  email: process.env.NOWPAYMENTS_EMAIL,
  password: process.env.NOWPAYMENTS_PASSWORD
});

// No manual sdk.authenticate() and no manual jwtToken plumbing are needed.
const payments = await sdk.listPayments({
  limit: 20,
  page: 0,
  sortBy: 'created_at',
  orderBy: 'desc'
});

console.log(payments.data);       // array of Payment objects
console.log(payments.pagesCount); // total pages
```

Manual token mode is still supported for advanced use cases:

```js
const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  jwtToken: process.env.NOWPAYMENTS_JWT_TOKEN
});

const payments = await sdk.listPayments({ limit: 20 });
```

You can still call `await sdk.authenticate()` explicitly if you need to inspect `sdk.jwtToken`, but application code normally should not need to pass JWTs between SDK instances anymore.

`sortBy` is the field name (e.g. `created_at`, `payment_id`). `orderBy` is `asc` or `desc` only. Snake-case aliases (`sort_by`, `order_by`) are accepted and normalized automatically.

---

## Mass payouts

### Simplified single payout with automatic 2FA

Configure dashboard credentials and the Base32 secret from the NOWPayments application-based 2FA setup. Store the secret in a secrets manager or protected environment variable; do not commit it to source control.

```js
import { NowPaymentsSDK } from '@nowpaymentsio/nowpayments-sdk-nodejs';

const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  email: process.env.NOWPAYMENTS_EMAIL,
  password: process.env.NOWPAYMENTS_PASSWORD,
  twoFactorSecret: process.env.NOWPAYMENTS_2FA_SECRET,
  payoutIpnCallbackUrl: 'https://example.com/webhooks/nowpayments/payouts'
});

const batch = await sdk.createPayout({
  address: 'TEmGwPeRTPiLFLVfBxXkSP91yc5GMNQhfS',
  currency: 'trx',
  amount: 10,
  uniqueExternalId: 'affiliate-1001',
  payoutDescription: 'Affiliate settlement'
});

console.log(batch.id);                    // batch id
console.log(batch.withdrawals[0].id);     // individual payout id
console.log(batch.verified);              // true
console.log(batch.requiresVerification);  // false
console.log(batch.preflight.totals.trx);  // balance and fee coverage details
```

Although the NOWPayments API requires `withdrawals` to be an array even for one payout, the SDK accepts a single withdrawal object and creates the API batch internally.

For this call the SDK performs the complete flow:

1. Obtains or refreshes a Bearer JWT from `email` and `password`.
2. Reads the available custody balance. Fiat-denominated withdrawals are estimated into their payout cryptocurrency first.
3. Fetches the current minimum withdrawal amount once per currency.
4. Fetches the current network-fee estimate for each withdrawal.
5. Aggregates requested amounts and fees per currency and rejects insufficient balance locally.
6. Creates the payout batch.
7. Generates a six-digit RFC 6238 TOTP code from `twoFactorSecret` and verifies the batch immediately.

The TOTP implementation uses Node's built-in `node:crypto`; the SDK has no runtime dependency on an OTP package. An `otpauth://...` URI is accepted as well as a raw Base32 secret.

A custom secret-manager or OTP-service integration can be supplied without exposing the secret to application code:

```js
const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  jwtToken: process.env.NOWPAYMENTS_JWT_TOKEN,
  twoFactorCodeProvider: async ({ batchId }) => {
    return getCurrentCodeFromSecureService(batchId);
  }
});
```

### No 2FA secret: explicit verification

When no `twoFactorSecret` and no `twoFactorCodeProvider` are configured, `createPayout()` still creates the batch but does not pretend it is complete. The result has `requiresVerification: true`; confirm it with the current six-digit code from the authenticator application or email.

```js
const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  email: process.env.NOWPAYMENTS_EMAIL,
  password: process.env.NOWPAYMENTS_PASSWORD,
  // No twoFactorSecret here.
});

const currentSixDigitCode = await readCodeFromYourSecureInput();

const batch = await sdk.createPayout({
  address: 'TEmGwPeRTPiLFLVfBxXkSP91yc5GMNQhfS',
  currency: 'trx',
  amount: 10
});

if (batch.requiresVerification) {
  const verification = await sdk.verifyPayout(batch.id, currentSixDigitCode);
  console.log(verification.verified); // true
}
```

A current code can also be supplied in the creation call. It is validated before any network request and used immediately after batch creation:

```js
const batch = await sdk.createPayout({
  address: 'TEmGwPeRTPiLFLVfBxXkSP91yc5GMNQhfS',
  currency: 'trx',
  amount: 10,
  verificationCode: currentSixDigitCode
});
```

`autoVerify: false` disables automatic confirmation for one call even when the SDK has a 2FA secret.

### Batch payout

```js
const batch = await sdk.createPayout({
  ipnCallbackUrl: 'https://example.com/webhooks/nowpayments/payouts',
  withdrawals: [
    {
      address: 'TEmGwPeRTPiLFLVfBxXkSP91yc5GMNQhfS',
      currency: 'trx',
      amount: 10,
      uniqueExternalId: 'affiliate-1001'
    },
    {
      address: '0x1EBAeF7Bee7B3a7B2EEfC72e86593Bf15ED37522',
      currency: 'eth',
      amount: 0.1,
      uniqueExternalId: 'affiliate-1002'
    }
  ]
});
```

Top-level `ipnCallbackUrl` applies to the whole batch, matching the raw API. Top-level `payoutDescription` is an SDK-only convenience: since `POST /v1/payout` rejects `payout_description` at the request root (`INVALID_REQUEST_PARAMS: payout_description is not allowed`), the SDK copies it onto every withdrawal that doesn't set its own `payoutDescription`. A `payoutDescription` set directly on a withdrawal always takes precedence over the batch-level value. Snake-case API field names are accepted alongside camelCase names.

### Automatic preflight

`createPayout()` runs preflight by default. The same check is available without creating a payout:

```js
const preflight = await sdk.preflightPayout({
  withdrawals: [
    { address: 'wallet-1', currency: 'trx', amount: 10 },
    { address: 'wallet-2', currency: 'trx', amount: 5 }
  ]
});

console.log(preflight.totals.trx);
// {
//   currency: 'trx',
//   available: 100,
//   pending: 0,
//   requestedAmount: 15,
//   estimatedFee: 0.2,
//   requiredAmount: 15.2,
//   coversAmount: true,
//   coversAmountAndFee: true
// }
```

The default `networkFeePaidBy: 'sender'` policy is conservative: available balance must cover both payout amounts and current fee estimates. This field is an SDK-side validation policy and is not sent to NOWPayments. With `networkFeePaidBy: 'recipient'`, the SDK requires balance for payout amounts and still reports whether fees are also covered.

Network fees are estimates at preflight time and the final fee can differ. `skipPreflight: true` is an advanced escape hatch for applications that intentionally perform equivalent checks elsewhere; it disables balance, minimum and fee validation for that call.

Typical preflight errors are deterministic and carry structured `details`:

| Code | Meaning |
|---|---|
| `BELOW_MINIMUM_PAYOUT_AMOUNT` | Effective crypto amount is below the current withdrawal minimum. |
| `INSUFFICIENT_PAYOUT_BALANCE` | Available balance does not cover requested payout amounts. |
| `INSUFFICIENT_PAYOUT_BALANCE_WITH_FEE` | Amounts are covered but amounts plus estimated fees are not. |
| `PAYOUT_MINIMUM_UNAVAILABLE` | The API did not return a usable minimum. |
| `INVALID_PAYOUT_FEE_ESTIMATE` | The API did not return a usable fee estimate. |

When batch creation succeeds but automatic verification fails, the SDK throws `APIError` with `code: PAYOUT_VERIFICATION_FAILED`. `error.details.batchId` identifies the already-created batch so the application can retry `verifyPayout()` rather than create a duplicate payout.

### Balance, minimum, fee and address helpers

```js
const balance = await sdk.getPayoutBalance();
const minimum = await sdk.getMinimumPayoutAmount('trx');
const fee = await sdk.getPayoutFeeEstimate({ currency: 'trx', amount: 10 });
const address = await sdk.validatePayoutAddress({
  address: 'TEmGwPeRTPiLFLVfBxXkSP91yc5GMNQhfS',
  currency: 'trx'
});

console.log(balance.trx.available);
console.log(minimum.minAmount);
console.log(fee.estimatedFee);
console.log(address.valid); // true, or INVALID_PAYOUT_ADDRESS is thrown
```

### Payout status: same model as payments

A status request takes the **individual payout id**, not the batch id.

```js
const payout = await sdk.getPayoutStatus('5000000000');
console.log(payout.payout_status); // raw API value, e.g. 'SENDING'
console.log(payout.status);        // stable SDK value, e.g. 'sending'
```

Polling uses the same EventEmitter and callback patterns as payment polling:

```js
const watcher = sdk.watchPayoutStatus('5000000000', {
  intervalMs: 5000,
  timeoutMs: 30 * 60 * 1000
});

watcher.on('change', ({ from, to, payout }) => {
  console.log(`${from} → ${to}`, payout.id);
});

watcher.on('terminal', (payout) => {
  console.log('final payout status:', payout.status);
});

const unsubscribe = sdk.onPayoutStatusChange(
  '5000000000',
  ({ from, to, payout }) => console.log(from, to, payout.id),
  { intervalMs: 5000 }
);
```

Payout watcher events are `status`, `change`, `terminal`, `timeout` and `error`. Terminal SDK statuses are `finished`, `failed`, `rejected` and `cancelled`.

### Listing payouts

```js
const payouts = await sdk.listPayouts({
  batchId: batch.id,
  status: 'finished',
  orderBy: 'dateCreated',
  order: 'desc',
  limit: 20,
  page: 0
});
```

Raw endpoint access remains available under `sdk.raw` for integrations that need the untouched API response.

---

## Webhooks / IPN

When creating a checkout/direct payment or payout, pass `ipnCallbackUrl`. NOWPayments sends a `POST` request to that URL when a payment or withdrawal status changes, with the signature in the `x-nowpayments-sig` header.

```js
// Express example
app.post('/webhooks/nowpayments', express.json(), (req, res) => {
  try {
    const event = sdk.parseWebhook(req.body, req.headers['x-nowpayments-sig']);

    if (event.type === 'payment.status_changed') {
      const payment = event.payment;
      console.log(payment.payment_id, payment.payment_status, '->', payment.status);
      // Update your order by payment.order_id or payment.purchase_id
    }

    if (event.type === 'payout.status_changed') {
      const payout = event.payout;
      console.log(payout.id, payout.payout_status, '->', payout.status);
      // Update your payout by payout.id, payout.batchId or payout.uniqueExternalId
    }

    res.json({ ok: true });
  } catch (error) {
    // Signature mismatch throws ValidationError with code INVALID_WEBHOOK_SIGNATURE
    res.status(400).json({ ok: false });
  }
});
```

Manual signature verification:

```js
const isValid = sdk.verifyWebhookSignature(
  req.body,
  req.headers['x-nowpayments-sig']
);
```

The SDK signs `JSON.stringify(sortObjectDeep(payload))` with HMAC SHA-512, matching NOWPayments IPN format.

---

## Payment status polling

Single check:

```js
const payment = await sdk.getPaymentStatus('5745459419');
console.log(payment.payment_status); // raw API status, e.g. 'waiting'
console.log(payment.status);         // SDK status, e.g. 'pending'
```

### `watchPaymentStatus` — EventEmitter

```js
const watcher = sdk.watchPaymentStatus('5745459419', {
  intervalMs: 5000,
  timeoutMs: 15 * 60 * 1000
});

watcher.on('change', ({ from, to, payment }) => {
  console.log(`${from} → ${to}`, payment.id);
});

watcher.on('terminal', (payment) => {
  console.log('final status:', payment.status);
});

watcher.on('timeout', ({ paymentId }) => {
  console.warn('polling timed out for', paymentId);
});

watcher.on('error', console.error);
```

Events emitted:

| Event | Payload | When |
|---|---|---|
| `status` | `Payment` | Every poll cycle |
| `change` | `{ from, to, payment }` | Status changed from a known previous status |
| `terminal` | `Payment` | Terminal status reached |
| `timeout` | `{ paymentId }` | `timeoutMs` elapsed without a terminal status |
| `error` | `Error` | Poll request failed |

### `onPaymentStatusChange` — callback shorthand

```js
const unsubscribe = sdk.onPaymentStatusChange('5745459419', ({ from, to, payment }) => {
  console.log(`${from ?? 'initial'} → ${to}`);

  if (to === 'paid') {
    console.log('Payment complete!', payment.id);
    unsubscribe(); // optional — watcher stops automatically on terminal
  }
}, { intervalMs: 5000 });
```

`from` is `null` when the payment is already in a terminal status on the first poll (no prior status seen). Otherwise it is the previous SDK status string.

The returned `unsubscribe()` function stops the underlying watcher. The watcher also stops automatically when a terminal status is reached.

---

## Currencies

```js
// All enabled currencies (GET /v1/full-currencies, filters enabled: true)
const currencies = await sdk.getAvailableCurrencies();

// All currencies including disabled ones
const all = await sdk.getAvailableCurrencies({ onlyEnabled: false });

// Currencies available for fixed-rate payments (GET /v1/currencies?fixed_rate=true)
const fixedRate = await sdk.getFixedRateCurrencies();

// Currencies enabled for this specific merchant account (GET /v1/merchant/coins)
const merchant = await sdk.getMerchantCurrencies();
```

---

## Estimate and minimum amount

```js
const estimate = await sdk.estimatePrice({
  amount: 100,
  fromCurrency: 'usd',
  toCurrency: 'btc'
});
console.log(estimate.estimated_amount); // BTC equivalent of $100

const minimum = await sdk.getMinimumPaymentAmount({
  fromCurrency: 'btc'
});
console.log(minimum.min_amount); // minimum BTC payment amount
```

---

## Public API

### Scenario methods

| Method | Description |
|---|---|
| `createCheckout(input)` | Creates a hosted checkout via `POST /v1/invoice`. Returns invoice-shaped object with `invoice_url`. |
| `createPayment(input)` | Alias for `createCheckout(input)`. |
| `createHostedCheckout(input)` | Alias for `createCheckout(input)`. |
| `createDirectPayment(input)` | Calls `POST /v1/payment`. Returns payment object with deposit address. |
| `watchPaymentStatus(paymentId, options)` | Starts payment polling. Emits `status`, `change`, `terminal`, `timeout`, `error`. |
| `onPaymentStatusChange(paymentId, callback, options)` | Convenience payment subscription. Returns `unsubscribe()`. |
| `createPayout(input)` | Creates a single payout or batch, runs preflight and confirms with 2FA when a code source is available. |
| `preflightPayout(input)` | Runs balance, minimum and fee checks without creating a payout. |
| `watchPayoutStatus(payoutId, options)` | Starts payout polling with the same event model as payments. |
| `onPayoutStatusChange(payoutId, callback, options)` | Convenience payout subscription. Returns `unsubscribe()`. |
| `parseWebhook(payload, signature, options)` | Verifies HMAC signature and returns a normalized event. |

### Endpoint coverage

| SDK method | NOWPayments endpoint |
|---|---|
| `estimatePrice(input)` | `GET /v1/estimate` |
| `getMinimumPaymentAmount(input)` | `GET /v1/min-amount` |
| `getAvailableCurrencies(options)` | `GET /v1/full-currencies` |
| `getFixedRateCurrencies()` | `GET /v1/currencies?fixed_rate=true` |
| `getMerchantCurrencies()` | `GET /v1/merchant/coins` |
| `createInvoice(input)` | `POST /v1/invoice` |
| `createPaymentFromInvoice(input)` | `POST /v1/invoice-payment` |
| `createDirectPayment(input)` | `POST /v1/payment` |
| `refreshPaymentEstimate(paymentId)` | `POST /v1/payment/{id}/update-merchant-estimate` |
| `getPaymentStatus(paymentId)` | `GET /v1/payment/{payment_id}` |
| `listPayments(query)` | `GET /v1/payment/` |
| `authenticate(credentials)` | `POST /v1/auth` |
| `getBalance()` / `getPayoutBalance()` | `GET /v1/balance` |
| `validatePayoutAddress(input)` | `POST /v1/payout/validate-address` |
| `createPayout(input)` | `POST /v1/payout` |
| `verifyPayout(batchId, code)` | `POST /v1/payout/{batch-withdrawal-id}/verify` |
| `getPayoutStatus(payoutId)` | `GET /v1/payout/{payout_id}` |
| `listPayouts(query)` | `GET /v1/payout` |
| `getPayoutFeeEstimate(input)` | `GET /v1/payout/fee` |
| `getMinimumPayoutAmount(currency)` | `GET /v1/payout-withdrawal/min-amount/{coin}` |

A `raw` client is available for direct API access:

```js
// Escape hatch — raw API response, no normalization
await sdk.raw.createInvoice({ price_amount: 10, price_currency: 'usd' });
await sdk.raw.getBalance();
await sdk.raw.createPayout({
  withdrawals: [{ address: 'wallet', currency: 'trx', amount: 10 }]
});
```

---

## Status mapping

| API status | SDK status |
|---|---|
| `waiting` | `pending` |
| `confirming` | `processing` |
| `confirmed` | `processing` |
| `sending` | `processing` |
| `finished` | `paid` |
| `partially_paid` | `partially_paid` |
| `failed` | `failed` |
| `refunded` | `refunded` |
| `expired` | `expired` |
| `cancelled` / `canceled` | `cancelled` |
| unknown / empty | `unknown` |

Terminal statuses (watcher stops automatically): `paid`, `partially_paid`, `failed`, `refunded`, `expired`, `cancelled`.

### Payout status mapping

| API status | SDK status |
|---|---|
| `new` / `creating` / `waiting` | `pending` |
| `processing` | `processing` |
| `sending` | `sending` |
| `finished` | `finished` |
| `failed` | `failed` |
| `rejected` / `rejected_not_checked` | `rejected` |
| `cancelled` / `canceled` | `cancelled` |
| unknown / empty | `unknown` |

`listPayouts({ status })` only accepts the statuses `GET /v1/payout` actually supports as a filter: `creating`, `waiting`, `processing`, `finished`, `failed`, and `rejected`. Other payout statuses (`new`, `sending`, `rejected_not_checked`, `cancelled`/`canceled`) can appear on individual payouts but are rejected by the API with a 400 when used as a list filter.

Terminal payout statuses: `finished`, `failed`, `rejected`, `cancelled`.

---

## Errors

All SDK errors extend `SDKError` and serialize predictably via `.toJSON()`:

```js
try {
  await sdk.createCheckout({ amount: 1, currency: 'usd', payCurrency: 'btc' });
} catch (error) {
  if (error.name === 'ValidationError') {
    console.log(error.type);       // 'validation'
    console.log(error.code);       // e.g. 'BELOW_MINIMUM_PAYMENT_AMOUNT'
    console.log(error.details);    // { estimatedPayAmount, minimumPayAmount, ... }
  }
  if (error.name === 'APIError') {
    console.log(error.httpStatus); // e.g. 401
    console.log(error.requestId);  // Cloudflare ray id if available
  }
}
```

| Error class | `type` | Typical cause |
|---|---|---|
| `ConfigurationError` | `configuration` | Missing API key, missing payout authentication or invalid 2FA configuration |
| `ValidationError` | `validation` | Invalid input, amount below minimum, insufficient payout balance or invalid address |
| `NetworkError` | `network` | Fetch / DNS / connection failure |
| `NetworkError` | `timeout` | Request exceeded `timeoutMs` |
| `APIError` | `api` | NOWPayments returned a non-2xx response |
| `SDKError` | `unknown` | Unexpected error wrapped by SDK utilities |

---

## Development

```bash
npm run build
npm test
```

Real-data Mass payouts integration tests are isolated from the normal unit suite:

```bash
cp .env.live.example .env.live
npm run test:live:payouts
```

The default live command is read-only. Real payout creation is available only through separate commands with an exact confirmation phrase, independent payout-amount and total-debit caps, and an idempotent run ID. See [`test/live/README.md`](./test/live/README.md) for automatic 2FA, manual 2FA and raw-client scenarios.

No runtime dependencies. Unit tests use Node's built-in `node:test` with a mock `fetch`; payout TOTP vectors are checked against RFC 6238. Type declarations are verified with TypeScript in strict NodeNext mode.
