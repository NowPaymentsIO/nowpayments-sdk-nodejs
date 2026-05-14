# NOWPayments Node.js SDK

Scenario-first SDK for accepting crypto payments via NOWPayments hosted checkout.

This package is built around the integration scenario from the technical brief: initialize SDK, create payment, get checkout URL, redirect customer, then track payment status. The SDK hides the orchestration of the public API calls where it can: estimate, minimum amount check, invoice/payment creation, normalization, status mapping, events, and consistent errors.

## Features

- Node.js >= 18, no runtime dependencies.
- ESM package with TypeScript declarations.
- Scenario API: `createPayment()` returns a hosted checkout URL.
- Direct API-compatible flow: `createDirectPayment()` returns deposit address data.
- Normalized public contract for payments, invoices, estimates, currencies, and payment lists.
- Stable SDK statuses: `pending`, `processing`, `paid`, `partially_paid`, `failed`, `refunded`, `expired`, `unknown`.
- Polling-based event model for payment status changes.
- IPN webhook signature verification with HMAC SHA-512 and recursively sorted payload keys.
- Consistent errors: `configuration`, `validation`, `network`, `timeout`, `api`, `unknown`.

## Installation

```bash
npm install @nowpayments-sdk/node
```

For local development from this generated archive:

```bash
npm install /path/to/nowpayments-node-sdk
```

## Quick start: hosted checkout

```js
import { NowPaymentsSDK } from '@nowpayments-sdk/node';

const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET,
  ipnCallbackUrl: 'https://example.com/webhooks/nowpayments',
  successUrl: 'https://example.com/payment/success',
  cancelUrl: 'https://example.com/payment/cancel'
});

const checkout = await sdk.createPayment({
  amount: 49.99,
  currency: 'usd',
  payCurrency: 'btc',
  orderId: 'order-1001',
  description: 'Demo order'
});

// Redirect the customer to hosted checkout.
console.log(checkout.checkoutUrl);
```

When `payCurrency` is provided, `createPayment()` performs a preflight flow:

1. `GET /v1/estimate`
2. `GET /v1/min-amount`
3. throws `ValidationError` if estimated pay amount is below minimum
4. `POST /v1/invoice`
5. returns a normalized `CheckoutSession` with `checkoutUrl`

When `payCurrency` is not provided, NOWPayments hosted checkout can let the customer choose the currency on the invoice page, so the SDK skips estimate/minimum preflight and creates the invoice directly.

## Direct payment flow

Use this when you want to show a deposit address inside your own UI instead of redirecting to hosted checkout.

```js
const payment = await sdk.createDirectPayment({
  amount: 100,
  currency: 'usd',
  payCurrency: 'trx',
  orderId: 'order-1002',
  ipnCallbackUrl: 'https://example.com/webhooks/nowpayments'
});

console.log(payment.deposit.address);
console.log(payment.deposit.memo); // may be required for some currencies
```

## Status tracking

### Single status request

```js
const payment = await sdk.getPaymentStatus('5745459419');
console.log(payment.status); // pending | processing | paid | partially_paid | failed | refunded | expired | unknown
```

### Event model by polling

```js
const watcher = sdk.watchPaymentStatus('5745459419', {
  intervalMs: 5000,
  timeoutMs: 15 * 60 * 1000
});

watcher.on('status', (payment) => {
  console.log('current status:', payment.status);
});

watcher.on('change', ({ from, to, payment }) => {
  console.log(`status changed: ${from} -> ${to}`, payment.id);
});

watcher.on('terminal', (payment) => {
  console.log('terminal status:', payment.status);
});

watcher.on('error', console.error);

// watcher.stop();
```

## Webhooks / IPN

```js
const event = sdk.parseWebhook(req.body, req.headers['x-nowpayments-sig']);

if (event.type === 'payment.status_changed') {
  const payment = event.payment;
  console.log(payment.id, payment.status);
}
```

For frameworks where you need manual verification:

```js
const isValid = sdk.verifyWebhookSignature(
  req.body,
  req.headers['x-nowpayments-sig']
);
```

The SDK signs `JSON.stringify(sortObjectDeep(payload))` using HMAC SHA-512, matching the NOWPayments IPN format.

## Public API

### Scenario methods

| Method | Description |
| --- | --- |
| `createPayment(input)` | Creates hosted checkout session. Alias for `createCheckout(input)`. |
| `createCheckout(input)` | Creates hosted checkout session and returns `checkoutUrl`. |
| `createHostedCheckout(input)` | Alias for `createCheckout(input)`. |
| `watchPaymentStatus(paymentId, options)` | Starts polling and emits `status`, `change`, `terminal`, `timeout`, `error`. |
| `onPaymentStatusChange(paymentId, callback, options)` | Convenience subscription returning `unsubscribe()`. |
| `parseWebhook(payload, signature, options)` | Verifies and normalizes IPN callback. |

### API coverage required by the brief

| SDK method | NOWPayments endpoint |
| --- | --- |
| `estimatePrice(input)` | `GET /v1/estimate` |
| `createDirectPayment(input)` | `POST /v1/payment` |
| `refreshPaymentEstimate(paymentId)` | `POST /v1/payment/{id}/update-merchant-estimate` |
| `getPaymentStatus(paymentId)` | `GET /v1/payment/{payment_id}` |
| `getMinimumPaymentAmount(input)` | `GET /v1/min-amount` |
| `listPayments(query)` | `GET /v1/payment/` |
| `createInvoice(input)` | `POST /v1/invoice` |
| `createPaymentFromInvoice(input)` | `POST /v1/invoice-payment` |
| `getAvailableCurrencies(options)` | `GET /v1/full-currencies` |

A `raw` client is also available for controlled escape hatches:

```js
await sdk.raw.createInvoice({ price_amount: 10, price_currency: 'usd' });
```

Prefer normalized methods for product integrations because the raw client returns provider-shaped data.

## Normalized objects

### CheckoutSession

```ts
type CheckoutSession = {
  id: string | null;
  checkoutUrl: string | null;
  status: 'pending';
  invoice: Invoice;
  payment: Payment | null;
  estimate: Estimate | null;
  minimum: MinimumAmount | null;
  createdAt: string | null;
  updatedAt: string | null;
};
```

### Payment

```ts
type Payment = {
  id: string | null;
  invoiceId: string | null;
  status: PaymentStatus;
  deposit: {
    address: string | null;
    memo: string | null;
    network: string | null;
    precision: number | null;
  };
  price: { amount: number | null; currency: string | null };
  payment: { amount: number | null; currency: string | null; actuallyPaid: number | null };
  outcome: { amount: number | null; currency: string | null };
  order: { id: string | null; description: string | null };
  purchaseId: string | null;
  callbackUrl: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};
```

## Status mapping

| API status | SDK status |
| --- | --- |
| `waiting` | `pending` |
| `confirming` | `processing` |
| `confirmed` | `processing` |
| `sending` | `processing` |
| `finished` | `paid` |
| `partially_paid` | `partially_paid` |
| `failed` | `failed` |
| `refunded` | `refunded` |
| `expired` | `expired` |
| unknown/empty | `unknown` |

## Errors

All SDK errors inherit from `SDKError` and serialize predictably:

```js
try {
  await sdk.createPayment({ amount: 1, currency: 'usd', payCurrency: 'btc' });
} catch (error) {
  if (error.name === 'ValidationError') {
    console.log(error.type); // validation
    console.log(error.code); // e.g. BELOW_MINIMUM_PAYMENT_AMOUNT
    console.log(error.details);
  }
}
```

Error types:

- `configuration` - SDK is missing required configuration, for example API key or IPN secret.
- `validation` - invalid input or preflight minimum amount check failed.
- `network` - fetch/network failure.
- `timeout` - request timeout.
- `api` - NOWPayments API returned non-2xx response.
- `unknown` - unexpected error wrapped by SDK utilities.

## Authentication for payment list

The public OpenAPI marks payment listing as Bearer-authenticated. You can pass a JWT token directly:

```js
const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  jwtToken: process.env.NOWPAYMENTS_JWT_TOKEN
});

const payments = await sdk.listPayments({ limit: 20, page: 0 });
```

Or configure dashboard credentials and let the SDK request a JWT before Bearer-authenticated calls:

```js
const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  email: process.env.NOWPAYMENTS_EMAIL,
  password: process.env.NOWPAYMENTS_PASSWORD
});

const token = await sdk.authenticate();
```

## Development

```bash
npm run build
npm test
```

The package has no runtime dependencies. Tests use Node's built-in `node:test` and mock `fetch`.
