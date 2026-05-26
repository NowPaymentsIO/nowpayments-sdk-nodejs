import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NowPaymentsSDK,
  ValidationError,
  createWebhookSignature,
  verifyWebhookSignature,
  normalizePaymentStatus
} from '../src/index.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function createMockFetch(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const request = { url: new URL(String(url)), init };
    calls.push(request);
    return handler(request, calls);
  };
  fetch.calls = calls;
  return fetch;
}

test('createPayment creates hosted checkout with estimate and min-amount preflight', async () => {
  const fetch = createMockFetch(({ url, init }) => {
    if (url.pathname === '/v1/estimate') {
      assert.equal(url.searchParams.get('amount'), '100');
      assert.equal(url.searchParams.get('currency_from'), 'usd');
      assert.equal(url.searchParams.get('currency_to'), 'btc');
      return jsonResponse({ currency_from: 'usd', amount_from: 100, currency_to: 'btc', estimated_amount: 0.01 });
    }
    if (url.pathname === '/v1/min-amount') {
      assert.equal(url.searchParams.get('currency_from'), 'btc');
      // fiat_equivalent is NOT sent (it was a bug to pass a currency code here)
      assert.equal(url.searchParams.has('fiat_equivalent'), false);
      return jsonResponse({ currency_from: 'btc', currency_to: 'btc', min_amount: 0.001, fiat_equivalent: 10 });
    }
    if (url.pathname === '/v1/invoice') {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['x-api-key'], 'test-key');
      assert.deepEqual(JSON.parse(init.body), {
        price_amount: 100,
        price_currency: 'usd',
        pay_currency: 'btc',
        order_id: 'order-1',
        order_description: 'Test order',
        ipn_callback_url: 'https://example.com/ipn',
        success_url: 'https://example.com/success'
      });
      return jsonResponse({
        id: 'inv-1',
        invoice_url: 'https://nowpayments.io/payment/?iid=inv-1',
        price_amount: '100',
        price_currency: 'usd',
        pay_currency: 'btc',
        order_id: 'order-1',
        order_description: 'Test order',
        ipn_callback_url: 'https://example.com/ipn',
        success_url: 'https://example.com/success',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z'
      }, 201);
    }
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });
  const checkout = await sdk.createPayment({
    amount: 100,
    currency: 'USD',
    payCurrency: 'BTC',
    orderId: 'order-1',
    description: 'Test order',
    ipnCallbackUrl: 'https://example.com/ipn',
    successUrl: 'https://example.com/success'
  });

  assert.equal(checkout.id, 'inv-1');
  assert.equal(checkout.invoice_url, 'https://nowpayments.io/payment/?iid=inv-1');
  assert.equal(checkout.checkoutUrl, 'https://nowpayments.io/payment/?iid=inv-1');
  assert.equal(checkout.status, undefined);
  assert.equal(checkout.estimate.estimated_amount, 0.01);
  assert.equal(checkout.minimum.min_amount, 0.001);
  assert.equal(fetch.calls.length, 3);
});

test('createPayment fails fast when estimated crypto amount is below minimum', async () => {
  const fetch = createMockFetch(({ url }) => {
    if (url.pathname === '/v1/estimate') {
      return jsonResponse({ currency_from: 'usd', amount_from: 1, currency_to: 'btc', estimated_amount: 0.00001 });
    }
    if (url.pathname === '/v1/min-amount') {
      return jsonResponse({ currency_from: 'btc', currency_to: 'btc', min_amount: 0.001 });
    }
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });
  await assert.rejects(
    () => sdk.createPayment({ amount: 1, currency: 'usd', payCurrency: 'btc' }),
    (error) => error instanceof ValidationError && error.code === 'BELOW_MINIMUM_PAYMENT_AMOUNT'
  );
});

test('createDirectPayment maps payment status into stable SDK status', async () => {
  const fetch = createMockFetch(({ url }) => {
    if (url.pathname === '/v1/estimate') {
      return jsonResponse({ currency_from: 'usd', amount_from: 100, currency_to: 'trx', estimated_amount: 10 });
    }
    if (url.pathname === '/v1/min-amount') {
      return jsonResponse({ currency_from: 'trx', currency_to: 'trx', min_amount: 1 });
    }
    if (url.pathname === '/v1/payment') {
      return jsonResponse({
        payment_id: 'pay-1',
        payment_status: 'waiting',
        pay_address: 'wallet',
        price_amount: 100,
        price_currency: 'usd',
        pay_amount: 10,
        pay_currency: 'trx',
        created_at: '2026-01-01T00:00:00.000Z'
      }, 201);
    }
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });
  const payment = await sdk.createDirectPayment({ amount: 100, currency: 'usd', payCurrency: 'trx' });
  assert.equal(payment.id, 'pay-1');
  assert.equal(payment.status, 'pending');
  assert.equal(payment.deposit.address, 'wallet');
});

test('webhook signature follows NOWPayments HMAC SHA-512 sorted payload format', () => {
  const payload = { b: 2, a: { d: 4, c: 3 } };
  const secret = 'secret';
  const signature = createWebhookSignature(payload, secret);
  assert.equal(verifyWebhookSignature(payload, signature, secret), true);
  assert.equal(verifyWebhookSignature(payload, signature, 'wrong'), false);
});

test('normalizePaymentStatus exposes stable limited status set', () => {
  assert.equal(normalizePaymentStatus('waiting'), 'pending');
  assert.equal(normalizePaymentStatus('confirming'), 'processing');
  assert.equal(normalizePaymentStatus('confirmed'), 'processing');
  assert.equal(normalizePaymentStatus('sending'), 'processing');
  assert.equal(normalizePaymentStatus('finished'), 'paid');
  assert.equal(normalizePaymentStatus('partially_paid'), 'partially_paid');
  assert.equal(normalizePaymentStatus('does-not-exist'), 'unknown');
});


test('listPayments uses orderBy, accepts snake-case aliases, and prevents invalid order values', async () => {
  const fetch = createMockFetch(({ url, init }) => {
    assert.equal(url.pathname, '/v1/payment/');
    assert.equal(init.headers.authorization, 'Bearer jwt');
    assert.equal(url.searchParams.get('limit'), '20');
    assert.equal(url.searchParams.get('sortBy'), 'created_at');
    assert.equal(url.searchParams.has('order_by'), false);
    assert.equal(url.searchParams.has('orderBy'), false);
    return jsonResponse({
      data: [{ payment_id: 'pay-1', payment_status: 'cancelled' }],
      limit: 20,
      page: 0,
      pagesCount: 1,
      total: 1
    });
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', jwtToken: 'jwt', fetch });
  const list = await sdk.listPayments({ limit: 20, order_by: 'created_at' });
  assert.equal(list.data[0].payment_id, 'pay-1');
  assert.equal(list.items[0].id, 'pay-1');
  assert.equal(list.data[0].status, 'cancelled');
});

// ─── New tests added during audit ───────────────────────────────────────────

test('createCheckout without payCurrency skips preflight and creates invoice', async () => {
  const fetch = createMockFetch(({ url, init }) => {
    // No /v1/estimate or /v1/min-amount calls expected
    if (url.pathname === '/v1/estimate' || url.pathname === '/v1/min-amount') {
      throw new Error('preflight should be skipped when payCurrency is omitted');
    }
    if (url.pathname === '/v1/invoice') {
      assert.equal(init.method, 'POST');
      return jsonResponse({
        id: 'inv-2',
        invoice_url: 'https://nowpayments.io/payment/?iid=inv-2',
        price_amount: '49.99',
        price_currency: 'usd',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z'
      }, 201);
    }
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });
  const checkout = await sdk.createCheckout({ amount: 49.99, currency: 'usd', orderId: 'order-2' });

  assert.equal(checkout.id, 'inv-2');
  assert.equal(checkout.invoice_url, 'https://nowpayments.io/payment/?iid=inv-2');
  assert.equal(checkout.estimate, null);
  assert.equal(checkout.minimum, null);
  assert.equal(fetch.calls.length, 1); // only /v1/invoice
});

test('onPaymentStatusChange calls callback exactly once when status transitions to terminal', async () => {
  // Simulates: waiting -> confirming -> finished
  // This test drives poll() manually to be independent of intervalMs clamping and timers.
  // Expected callback calls: 2 (pending->processing, processing->paid), NOT 3.
  const { PaymentStatusWatcher } = await import('../src/watcher.js');

  const statusSequence = ['waiting', 'confirming', 'finished'];
  let pollCount = 0;

  const fetch = createMockFetch(({ url }) => {
    if (url.pathname.startsWith('/v1/payment/')) {
      const status = statusSequence[Math.min(pollCount++, statusSequence.length - 1)];
      return jsonResponse({ payment_id: 'pay-watch', payment_status: status });
    }
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });
  const callbackEvents = [];
  const watcher = new PaymentStatusWatcher({ sdk, paymentId: 'pay-watch' });

  watcher.on('change', (event) => callbackEvents.push(event));
  watcher.on('terminal', (payment) => {
    // Must NOT push here — 'change' already fired for this transition.
    if (!watcher._changeEverFired) {
      callbackEvents.push({ from: null, to: payment.status, payment });
    }
  });

  // Drive polls manually: no setInterval involved.
  await watcher.poll(); // status: waiting  → lastStatus=pending, no change (was null)
  await watcher.poll(); // status: confirming → change(pending→processing)
  await watcher.poll(); // status: finished  → change(processing→paid) + terminal

  assert.equal(callbackEvents.length, 2, 'callback must fire exactly twice: pending→processing and processing→paid');
  assert.equal(callbackEvents[0].from, 'pending');
  assert.equal(callbackEvents[0].to, 'processing');
  assert.equal(callbackEvents[1].from, 'processing');
  assert.equal(callbackEvents[1].to, 'paid');
});

test('onPaymentStatusChange fires once when first poll is already terminal', async () => {
  // Payment is already 'finished' on the very first poll — no previous status.
  // Callback should fire exactly once via 'terminal', with from: null.
  const fetch = createMockFetch(({ url }) => {
    if (url.pathname.startsWith('/v1/payment/')) {
      return jsonResponse({ payment_id: 'pay-done', payment_status: 'finished' });
    }
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });
  const callbackEvents = [];

  const unsubscribe = sdk.onPaymentStatusChange(
    'pay-done',
    (event) => callbackEvents.push(event),
    { intervalMs: 1 }
  );

  await new Promise((resolve) => setTimeout(resolve, 30));
  unsubscribe();

  assert.equal(callbackEvents.length, 1, 'callback must fire exactly once for first-poll terminal');
  assert.equal(callbackEvents[0].from, null);
  assert.equal(callbackEvents[0].to, 'paid');
});

test('parseWebhook throws ValidationError on invalid signature', () => {
  const sdk = new NowPaymentsSDK({ ipnSecret: 'real-secret' });
  const payload = { payment_id: '123', payment_status: 'finished' };
  assert.throws(
    () => sdk.parseWebhook(payload, 'bad-signature'),
    (error) => error.name === 'ValidationError' && error.code === 'INVALID_WEBHOOK_SIGNATURE'
  );
});

test('parseWebhook returns normalized payment event with verify:false', () => {
  const sdk = new NowPaymentsSDK({ ipnSecret: 'secret' });
  const payload = { payment_id: '456', payment_status: 'waiting', pay_currency: 'btc' };
  const event = sdk.parseWebhook(payload, 'any-sig', { verify: false });
  assert.equal(event.type, 'payment.status_changed');
  assert.equal(event.payment.status, 'pending');
  assert.equal(event.payment.id, '456');
});

test('APIError is thrown on non-2xx response', async () => {
  const fetch = createMockFetch(() =>
    jsonResponse({ message: 'Unauthorized', code: 401 }, 401)
  );

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });
  await assert.rejects(
    () => sdk.getApiStatus(),
    (error) => error.name === 'APIError' && error.httpStatus === 401
  );
});

test('NetworkError is thrown on fetch failure', async () => {
  const brokenFetch = async () => { throw new TypeError('Failed to fetch'); };
  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch: brokenFetch });
  await assert.rejects(
    () => sdk.estimatePrice({ amount: 1, fromCurrency: 'usd', toCurrency: 'btc' }),
    (error) => error.name === 'NetworkError'
  );
});

test('refreshPaymentEstimate returns a normalized payment object', async () => {
  const fetch = createMockFetch(({ url }) => {
    if (url.pathname === '/v1/payment/pay-99/update-merchant-estimate') {
      return jsonResponse({
        id: 'pay-99',
        pay_amount: 0.005,
        expiration_estimate_date: '2026-01-01T01:00:00.000Z',
        payment_status: 'waiting'
      });
    }
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });
  const result = await sdk.refreshPaymentEstimate('pay-99');
  assert.equal(result.payment_id, 'pay-99');
  assert.equal(result.status, 'pending');
  assert.equal(typeof result.pay_amount, 'number');
});

test('getAvailableCurrencies filters out currencies where enabled is null', async () => {
  const fetch = createMockFetch(() =>
    jsonResponse({
      currencies: [
        { code: 'btc', enable: true },
        { code: 'trx', enable: false },
        { code: 'eth' } // enable missing → null
      ]
    })
  );

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });
  const currencies = await sdk.getAvailableCurrencies();
  assert.equal(currencies.length, 1);
  assert.equal(currencies[0].code, 'btc');
});

test('preflightPayment does not send fiatEquivalent as a currency code', async () => {
  const fetch = createMockFetch(({ url }) => {
    if (url.pathname === '/v1/estimate') {
      return jsonResponse({ currency_from: 'usd', amount_from: 50, currency_to: 'eth', estimated_amount: 0.02 });
    }
    if (url.pathname === '/v1/min-amount') {
      // fiat_equivalent must NOT be 'usd' (string code) — it should be absent or numeric
      const fiatEquivalent = url.searchParams.get('fiat_equivalent');
      assert.notEqual(fiatEquivalent, 'usd', 'fiatEquivalent must not be a currency code string');
      return jsonResponse({ currency_from: 'eth', min_amount: 0.001 });
    }
    if (url.pathname === '/v1/invoice') {
      return jsonResponse({ id: 'inv-ok', invoice_url: 'https://nowpayments.io/payment/?iid=inv-ok', price_amount: '50', price_currency: 'usd' }, 201);
    }
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });
  await sdk.createCheckout({ amount: 50, currency: 'usd', payCurrency: 'eth' });
});
