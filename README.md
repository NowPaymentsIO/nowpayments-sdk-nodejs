# NOWPayments Node.js SDK

Scenario-first SDK for accepting crypto payments with NOWPayments from Node.js.

The main SDK scenario is: initialize SDK -> create hosted checkout -> redirect the customer -> receive IPN/webhook status updates or poll payment status. The SDK still keeps the response bodies close to the public NOWPayments API shape, so `invoice_url`, `payment_id`, `payment_status`, `pay_address`, `pay_amount`, `orderBy`, and other familiar fields stay recognizable.

## Features

- Node.js >= 18, ESM, no runtime dependencies.
- Hosted checkout flow through `createCheckout()` / `createPayment()`.
- Direct payment flow through `createDirectPayment()` for in-page deposit address UI.
- API-shaped responses with non-enumerable convenience aliases such as `checkout.checkoutUrl` and `payment.id`.
- Stable SDK payment statuses: `pending`, `processing`, `paid`, `partially_paid`, `failed`, `refunded`, `expired`, `cancelled`, `unknown`.
- Payment status polling events.
- IPN/webhook signature verification with HMAC SHA-512 and recursively sorted payload keys.
- Consistent `configuration`, `validation`, `network`, `timeout`, `api`, and `unknown` errors.

## Installation

```bash
npm install @nowpayments-sdk/node
```

For local development from this generated archive:

```bash
npm install /path/to/nowpayments-node-sdk
```

## Quick start: hosted checkout

Use this when you want to redirect the customer to NOWPayments hosted checkout.

```js
import { NowPaymentsSDK } from '@nowpayments-sdk/node';

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
  payCurrency: 'btc',
  orderId: 'order-1001',
  description: 'Demo order'
});

console.log(checkout.id);          // invoice id
console.log(checkout.invoice_url); // redirect user to this URL
```

`createPayment(input)` is kept as an alias for `createCheckout(input)` because the SDK scenario is “create a payment for the customer”. Under the hood, hosted checkout is created by NOWPayments `POST /v1/invoice`, so the returned body is invoice-shaped and does not include a payment status. A real payment appears after the customer opens the invoice and chooses/sends funds; track that payment by IPN/webhook or payment status endpoints.

When `payCurrency` is provided, `createCheckout()` performs preflight:

1. `GET /v1/estimate`
2. `GET /v1/min-amount`
3. throws `ValidationError` if `estimate.estimated_amount` is below `minimum.min_amount`
4. `POST /v1/invoice`
5. returns an invoice-shaped checkout object

Example response shape:

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
  estimate: {
    currency_from: 'usd',
    amount_from: 49.99,
    currency_to: 'btc',
    estimated_amount: 0.00042
  },
  minimum: {
    currency_from: 'btc',
    currency_to: 'btc',
    min_amount: 0.0001,
    fiat_equivalent: 12.34
  }
}
```

`estimate.estimated_amount` is the amount in `estimate.currency_to`. `estimate.amount_from` is the original amount in `estimate.currency_from`.

When `payCurrency` is not provided, NOWPayments lets the customer choose a payment currency on the invoice page, so estimate/minimum preflight is skipped.

## Direct payment flow

Use this when you want to show the deposit address in your own UI instead of redirecting to hosted checkout.

```js
const payment = await sdk.createDirectPayment({
  amount: 100,
  currency: 'usd',
  payCurrency: 'trx',
  orderId: 'order-1002',
  ipnCallbackUrl: 'https://example.com/webhooks/nowpayments'
});

console.log(payment.payment_id);   // API field
console.log(payment.id);           // convenience alias
console.log(payment.pay_address);  // API field
console.log(payment.deposit.memo); // may be required for XRP/XLM/etc.
```

## Authentication

`POST /v1/auth` does not require an API key. It requires dashboard email and password and returns a short-lived JWT token.

```js
const authSdk = new NowPaymentsSDK({
  email: process.env.NOWPAYMENTS_EMAIL,
  password: process.env.NOWPAYMENTS_PASSWORD
});

const token = await authSdk.authenticate();
console.log(token);
console.log(authSdk.jwtToken);
```

## List payments

`GET /v1/payment/` requires both `x-api-key` and Bearer JWT. You can pass a JWT directly:

```js
const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  jwtToken: process.env.NOWPAYMENTS_JWT_TOKEN
});

const payments = await sdk.listPayments({
  limit: 20,
  page: 0,
  sortBy: 'created_at',
  orderBy: 'desc'
});

console.log(payments.data);
```

Or authenticate first and then reuse the token:

```js
const authSdk = new NowPaymentsSDK({
  email: process.env.NOWPAYMENTS_EMAIL,
  password: process.env.NOWPAYMENTS_PASSWORD
});

await authSdk.authenticate();

const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  jwtToken: authSdk.jwtToken
});

const payments = await sdk.listPayments({ limit: 20, sortBy: 'created_at', orderBy: 'desc' });
```

`sortBy` is the field, for example `created_at` or `payment_id`. `orderBy` is only `asc` or `desc`. The SDK also accepts snake-case aliases such as `order_by`, but sends the NOWPayments query parameter as `orderBy` to avoid `Invalid order_by value` API errors.

## Webhooks / IPN

Use IPN/webhooks when you need automatic payment status updates without polling.

When creating a hosted checkout or direct payment, pass `ipnCallbackUrl`:

```js
const checkout = await sdk.createCheckout({
  amount: 49.99,
  currency: 'usd',
  payCurrency: 'btc',
  orderId: 'order-1001',
  ipnCallbackUrl: 'https://example.com/webhooks/nowpayments'
});
```

When the payment status changes, NOWPayments sends a `POST` request to that URL. The request body is similar to `GET /v1/payment/{payment_id}` and the signature is in the `x-nowpayments-sig` header. Your server should verify the signature and then update the order in your database.

```js
const event = sdk.parseWebhook(req.body, req.headers['x-nowpayments-sig']);

if (event.type === 'payment.status_changed') {
  const payment = event.payment;
  console.log(payment.payment_id, payment.status, payment.payment_status);
  // Update order by payment.order_id / payment.purchase_id here.
}
```

Manual signature verification:

```js
const isValid = sdk.verifyWebhookSignature(
  req.body,
  req.headers['x-nowpayments-sig']
);
```

The SDK signs `JSON.stringify(sortObjectDeep(payload))` using HMAC SHA-512, matching the NOWPayments IPN format.

## Status tracking by polling

```js
const payment = await sdk.getPaymentStatus('5745459419');
console.log(payment.payment_status); // raw API status, e.g. waiting
console.log(payment.status);         // SDK status, e.g. pending
```

```js
const watcher = sdk.watchPaymentStatus('5745459419', {
  intervalMs: 5000,
  timeoutMs: 15 * 60 * 1000
});

watcher.on('change', ({ from, to, payment }) => {
  console.log(`status changed: ${from} -> ${to}`, payment.id);
});

watcher.on('terminal', (payment) => {
  console.log('terminal status:', payment.status);
});

watcher.on('error', console.error);
```

## Public API

### Scenario methods

| Method | Description |
| --- | --- |
| `createCheckout(input)` | Creates hosted checkout by creating a NOWPayments invoice and returns `invoice_url`. |
| `createPayment(input)` | Alias for `createCheckout(input)` for the high-level SDK scenario. |
| `createHostedCheckout(input)` | Alias for `createCheckout(input)`. |
| `createDirectPayment(input)` | Calls `POST /v1/payment` and returns deposit address/payment data. |
| `watchPaymentStatus(paymentId, options)` | Starts polling and emits `status`, `change`, `terminal`, `timeout`, `error`. |
| `onPaymentStatusChange(paymentId, callback, options)` | Convenience subscription returning `unsubscribe()`. |
| `parseWebhook(payload, signature, options)` | Verifies and normalizes IPN callback. |

### Endpoint coverage

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

A `raw` client is available for controlled escape hatches:

```js
await sdk.raw.createInvoice({ price_amount: 10, price_currency: 'usd' });
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
| `cancelled` / `canceled` | `cancelled` |
| unknown/empty | `unknown` |

## Errors

All SDK errors inherit from `SDKError` and serialize predictably:

```js
try {
  await sdk.createCheckout({ amount: 1, currency: 'usd', payCurrency: 'btc' });
} catch (error) {
  if (error.name === 'ValidationError') {
    console.log(error.type);    // validation
    console.log(error.code);    // e.g. BELOW_MINIMUM_PAYMENT_AMOUNT
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

## Development

```bash
npm run build
npm test
```

The package has no runtime dependencies. Tests use Node's built-in `node:test` and mock `fetch`.
