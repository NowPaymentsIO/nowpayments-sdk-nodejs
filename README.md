# NOWPayments Node.js SDK

Scenario-first SDK for accepting crypto payments with NOWPayments from Node.js.

The main SDK scenario is: initialize SDK → create hosted checkout → redirect the customer → receive IPN/webhook status updates or poll payment status. The SDK keeps response bodies close to the NOWPayments API shape, so `invoice_url`, `payment_id`, `payment_status`, `pay_address`, `pay_amount`, and other familiar fields stay recognizable.

## Features

- Node.js >= 18, ESM, no runtime dependencies.
- Hosted checkout flow through `createCheckout()` / `createPayment()`.
- Direct payment flow through `createDirectPayment()` for in-page deposit address UI.
- API-shaped responses with non-enumerable convenience aliases such as `checkout.checkoutUrl` and `payment.id`.
- Stable SDK payment statuses: `pending`, `processing`, `paid`, `partially_paid`, `failed`, `refunded`, `expired`, `cancelled`, `unknown`.
- Payment status polling with `watchPaymentStatus()` and `onPaymentStatusChange()`.
- IPN/webhook signature verification with HMAC SHA-512 and recursively sorted payload keys.
- Consistent `configuration`, `validation`, `network`, `timeout`, `api`, and `unknown` error types.

## Installation

```bash
npm install @nowpayments-sdk/node
```

For local development from this archive:

```bash
npm install /path/to/nowpayments-node-sdk
```

---

## Quick start: hosted checkout

Use this when you want to redirect the customer to the NOWPayments hosted checkout page.

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

Some NOWPayments endpoints, for example `GET /v1/payment/`, require both `x-api-key` and a Bearer JWT. `POST /v1/auth` returns this JWT from dashboard `email` + `password`; the token is short-lived, so the SDK now keeps this work under the hood.

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

## Webhooks / IPN

When creating a checkout or direct payment, pass `ipnCallbackUrl`. When the payment status changes, NOWPayments sends a `POST` request to that URL with a JSON body and the signature in the `x-nowpayments-sig` header.

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
| `watchPaymentStatus(paymentId, options)` | Starts polling. Emits `status`, `change`, `terminal`, `timeout`, `error`. |
| `onPaymentStatusChange(paymentId, callback, options)` | Convenience subscription. Returns `unsubscribe()`. |
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

A `raw` client is available for direct API access:

```js
// Escape hatch — raw API response, no normalization
await sdk.raw.createInvoice({ price_amount: 10, price_currency: 'usd' });
await sdk.raw.getBalance();
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
| `ConfigurationError` | `configuration` | Missing API key or IPN secret |
| `ValidationError` | `validation` | Invalid input or amount below minimum |
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

No runtime dependencies. Tests use Node's built-in `node:test` with a mock `fetch`.
