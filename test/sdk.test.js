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
      assert.equal(url.searchParams.get('fiat_equivalent'), 'usd');
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
  assert.equal(checkout.checkoutUrl, 'https://nowpayments.io/payment/?iid=inv-1');
  assert.equal(checkout.status, 'pending');
  assert.equal(checkout.estimate.amount, 0.01);
  assert.equal(checkout.minimum.amount, 0.001);
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
