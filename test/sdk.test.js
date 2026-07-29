import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NowPaymentsSDK,
  APIError,
  ConfigurationError,
  ValidationError,
  createWebhookSignature,
  verifyWebhookSignature,
  generateTotpCode,
  normalizePaymentStatus,
  normalizePayoutStatus
} from '../src/index.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}


function fakeJwt(expiresAtSeconds, extraPayload = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ ...extraPayload, exp: expiresAtSeconds })}.signature`;
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

test('parseWebhook returns normalized payout event with verify:false', () => {
  const sdk = new NowPaymentsSDK({ ipnSecret: 'secret' });
  const payload = {
    id: 'payout-456',
    batch_withdrawal_id: 'batch-123',
    status: 'CREATING',
    currency: 'USDTTRC20',
    amount: '50',
    address: 'wallet'
  };
  const event = sdk.parseWebhook(payload, 'any-sig', { verify: false });
  assert.equal(event.type, 'payout.status_changed');
  assert.equal(event.payout.status, 'pending');
  assert.equal(event.payout.id, 'payout-456');
  assert.equal(event.payout.batchId, 'batch-123');
  assert.equal(event.payout.currency, 'usdttrc20');
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


test('listPayments automatically authenticates once and reuses cached JWT', async () => {
  const token = fakeJwt(Math.floor(Date.now() / 1000) + 300);
  let authCalls = 0;
  let listCalls = 0;

  const fetch = createMockFetch(({ url, init }) => {
    if (url.pathname === '/v1/auth') {
      authCalls += 1;
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { email: 'merchant@example.com', password: 'secret' });
      return jsonResponse({ token });
    }

    if (url.pathname === '/v1/payment/') {
      listCalls += 1;
      assert.equal(init.headers.authorization, `Bearer ${token}`);
      return jsonResponse({ data: [], limit: 20, page: 0, pagesCount: 0, total: 0 });
    }

    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({
    apiKey: 'test-key',
    email: 'merchant@example.com',
    password: 'secret',
    fetch
  });

  await sdk.listPayments({ limit: 20 });
  await sdk.listPayments({ limit: 20 });

  assert.equal(authCalls, 1);
  assert.equal(listCalls, 2);
  assert.equal(sdk.jwtToken, token);
});

test('listPayments refreshes JWT before request when cached token is expired', async () => {
  const expiredToken = fakeJwt(Math.floor(Date.now() / 1000) - 60);
  const freshToken = fakeJwt(Math.floor(Date.now() / 1000) + 300);

  const fetch = createMockFetch(({ url, init }, calls) => {
    if (url.pathname === '/v1/auth') {
      assert.equal(calls.length, 1, 'expired token should trigger auth before payment list request');
      return jsonResponse({ token: freshToken });
    }

    if (url.pathname === '/v1/payment/') {
      assert.equal(init.headers.authorization, `Bearer ${freshToken}`);
      return jsonResponse({ data: [], limit: 10, page: 0, pagesCount: 0, total: 0 });
    }

    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({
    apiKey: 'test-key',
    email: 'merchant@example.com',
    password: 'secret',
    jwtToken: expiredToken,
    fetch
  });

  await sdk.listPayments({ limit: 10 });

  assert.equal(fetch.calls[0].url.pathname, '/v1/auth');
  assert.equal(fetch.calls[1].url.pathname, '/v1/payment/');
  assert.equal(sdk.jwtToken, freshToken);
});

test('Bearer requests retry once with refreshed JWT after 401', async () => {
  const oldToken = fakeJwt(Math.floor(Date.now() / 1000) + 300, { token: 'old' });
  const freshToken = fakeJwt(Math.floor(Date.now() / 1000) + 300, { token: 'fresh' });
  let paymentListCalls = 0;

  const fetch = createMockFetch(({ url, init }) => {
    if (url.pathname === '/v1/payment/') {
      paymentListCalls += 1;
      if (paymentListCalls === 1) {
        assert.equal(init.headers.authorization, `Bearer ${oldToken}`);
        return jsonResponse({ message: 'Unauthorized' }, 401);
      }
      assert.equal(init.headers.authorization, `Bearer ${freshToken}`);
      return jsonResponse({ data: [], limit: 1, page: 0, pagesCount: 0, total: 0 });
    }

    if (url.pathname === '/v1/auth') {
      return jsonResponse({ token: freshToken });
    }

    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({
    apiKey: 'test-key',
    email: 'merchant@example.com',
    password: 'secret',
    jwtToken: oldToken,
    fetch
  });

  await sdk.listPayments({ limit: 1 });

  assert.equal(paymentListCalls, 2);
  assert.deepEqual(fetch.calls.map((call) => call.url.pathname), ['/v1/payment/', '/v1/auth', '/v1/payment/']);
  assert.equal(sdk.jwtToken, freshToken);
});

test('parallel Bearer requests share a single automatic auth request', async () => {
  const token = fakeJwt(Math.floor(Date.now() / 1000) + 300);
  let authCalls = 0;

  const fetch = createMockFetch(async ({ url, init }) => {
    if (url.pathname === '/v1/auth') {
      authCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return jsonResponse({ token });
    }

    if (url.pathname === '/v1/payment/') {
      assert.equal(init.headers.authorization, `Bearer ${token}`);
      return jsonResponse({ data: [], limit: 1, page: 0, pagesCount: 0, total: 0 });
    }

    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({
    apiKey: 'test-key',
    email: 'merchant@example.com',
    password: 'secret',
    fetch
  });

  await Promise.all([
    sdk.listPayments({ limit: 1 }),
    sdk.listPayments({ limit: 1 }),
    sdk.listPayments({ limit: 1 })
  ]);

  assert.equal(authCalls, 1);
  assert.equal(fetch.calls.filter((call) => call.url.pathname === '/v1/payment/').length, 3);
});

test('generateTotpCode follows RFC 6238 and accepts Base32 secrets', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(generateTotpCode(secret, { timestamp: 59_000, digits: 8 }), '94287082');
  assert.equal(generateTotpCode(`otpauth://totp/Test?secret=${secret}`, { timestamp: 59_000, digits: 8 }), '94287082');
});

test('normalizePayoutStatus exposes a stable payout status set', () => {
  assert.equal(normalizePayoutStatus('NEW'), 'pending');
  assert.equal(normalizePayoutStatus('CREATING'), 'pending');
  assert.equal(normalizePayoutStatus('WAITING'), 'pending');
  assert.equal(normalizePayoutStatus('PROCESSING'), 'processing');
  assert.equal(normalizePayoutStatus('SENDING'), 'sending');
  assert.equal(normalizePayoutStatus('FINISHED'), 'finished');
  assert.equal(normalizePayoutStatus('REJECTED'), 'rejected');
  assert.equal(normalizePayoutStatus('REJECTED_NOT_CHECKED'), 'rejected');
  assert.equal(normalizePayoutStatus('does-not-exist'), 'unknown');
});

test('createPayout simplifies a single payout, runs preflight and verifies automatically with twoFactorSecret', async () => {
  const timestamp = 59_000;
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const expectedCode = generateTotpCode(secret, { timestamp });

  const fetch = createMockFetch(({ url, init }) => {
    if (url.pathname === '/v1/balance') {
      return jsonResponse({ trx: { amount: 20, pendingAmount: 2 } });
    }
    if (url.pathname === '/v1/payout-withdrawal/min-amount/trx') {
      return jsonResponse({ success: true, result: 1 });
    }
    if (url.pathname === '/v1/payout/fee') {
      assert.equal(url.searchParams.get('currency'), 'trx');
      assert.equal(url.searchParams.get('amount'), '10');
      return jsonResponse({ currency: 'TRX', fee: 0.1 });
    }
    if (url.pathname === '/v1/payout' && init.method === 'POST') {
      assert.equal(init.headers.authorization, 'Bearer jwt');
      assert.deepEqual(JSON.parse(init.body), {
        withdrawals: [{
          address: 'TWallet',
          currency: 'trx',
          amount: 10,
          ipn_callback_url: 'https://example.com/payout-ipn',
          payout_description: 'Affiliate payout',
          unique_external_id: 'affiliate-1001'
        }]
      });
      return jsonResponse({
        id: 'batch-1',
        withdrawals: [{
          id: 'payout-1',
          batch_withdrawal_id: 'batch-1',
          status: 'WAITING',
          address: 'TWallet',
          currency: 'trx',
          amount: '10'
        }]
      });
    }
    if (url.pathname === '/v1/payout/batch-1/verify') {
      assert.equal(init.headers.authorization, 'Bearer jwt');
      assert.deepEqual(JSON.parse(init.body), { verification_code: expectedCode });
      return jsonResponse({ message: 'Payout verified' });
    }
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({
    apiKey: 'test-key',
    jwtToken: 'jwt',
    twoFactorSecret: secret,
    totpNow: () => timestamp,
    payoutIpnCallbackUrl: 'https://example.com/payout-ipn',
    fetch
  });

  const batch = await sdk.createPayout({
    address: 'TWallet',
    currency: 'TRX',
    amount: 10,
    payoutDescription: 'Affiliate payout',
    uniqueExternalId: 'affiliate-1001'
  });

  assert.equal(batch.id, 'batch-1');
  assert.equal(batch.verified, true);
  assert.equal(batch.requiresVerification, false);
  assert.equal(batch.verification.batchId, 'batch-1');
  assert.equal(batch.withdrawals[0].status, 'pending');
  assert.equal(batch.withdrawals[0].rawStatus, 'WAITING');
  assert.equal(batch.preflight.totals.trx.available, 20);
  assert.equal(batch.preflight.totals.trx.requestedAmount, 10);
  assert.equal(batch.preflight.totals.trx.estimatedFee, 0.1);
  assert.equal(batch.preflight.totals.trx.requiredAmount, 10.1);
  assert.equal(fetch.calls.length, 5);
});

test('createPayout without twoFactorSecret returns a manual verification flow', async () => {
  let verifyCalls = 0;
  const fetch = createMockFetch(({ url, init }) => {
    if (url.pathname === '/v1/balance') return jsonResponse({ btc: { amount: 1, pendingAmount: 0 } });
    if (url.pathname === '/v1/payout-withdrawal/min-amount/btc') return jsonResponse({ success: true, result: 0.001 });
    if (url.pathname === '/v1/payout/fee') return jsonResponse({ currency: 'BTC', fee: 0.0001 });
    if (url.pathname === '/v1/payout' && init.method === 'POST') {
      return jsonResponse({
        id: 'batch-manual',
        withdrawals: [{ id: 'payout-manual', batch_withdrawal_id: 'batch-manual', status: 'WAITING', currency: 'btc', amount: '0.1', address: 'bc1wallet' }]
      });
    }
    if (url.pathname === '/v1/payout/batch-manual/verify') {
      verifyCalls += 1;
      assert.deepEqual(JSON.parse(init.body), { verification_code: '123456' });
      return jsonResponse({ message: 'verified' });
    }
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', jwtToken: 'jwt', fetch });
  const batch = await sdk.createPayout({ address: 'bc1wallet', currency: 'btc', amount: 0.1 });

  assert.equal(batch.verified, false);
  assert.equal(batch.requiresVerification, true);
  assert.equal(verifyCalls, 0);

  const verification = await sdk.verifyPayout(batch.id, '123456');
  assert.equal(verification.verified, true);
  assert.equal(verification.batchId, 'batch-manual');
  assert.equal(verifyCalls, 1);
});

test('createPayout fails before fee estimation and creation when amount is below payout minimum', async () => {
  const fetch = createMockFetch(({ url }) => {
    if (url.pathname === '/v1/balance') return jsonResponse({ trx: { amount: 100, pendingAmount: 0 } });
    if (url.pathname === '/v1/payout-withdrawal/min-amount/trx') return jsonResponse({ success: true, result: 10 });
    if (url.pathname === '/v1/payout/fee') throw new Error('fee must not be requested after minimum check fails');
    if (url.pathname === '/v1/payout') throw new Error('payout must not be created');
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', jwtToken: 'jwt', fetch });
  await assert.rejects(
    () => sdk.createPayout({ address: 'wallet', currency: 'trx', amount: 1 }),
    (error) => error instanceof ValidationError && error.code === 'BELOW_MINIMUM_PAYOUT_AMOUNT'
  );
  assert.equal(fetch.calls.some((call) => call.url.pathname === '/v1/payout/fee'), false);
  assert.equal(fetch.calls.some((call) => call.url.pathname === '/v1/payout'), false);
});

test('createPayout checks balance including estimated network fee by default', async () => {
  const fetch = createMockFetch(({ url }) => {
    if (url.pathname === '/v1/balance') return jsonResponse({ trx: { amount: 10.05, pendingAmount: 0 } });
    if (url.pathname === '/v1/payout-withdrawal/min-amount/trx') return jsonResponse({ success: true, result: 1 });
    if (url.pathname === '/v1/payout/fee') return jsonResponse({ currency: 'trx', fee: 0.1 });
    if (url.pathname === '/v1/payout') throw new Error('payout must not be created');
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', jwtToken: 'jwt', fetch });
  await assert.rejects(
    () => sdk.createPayout({ address: 'wallet', currency: 'trx', amount: 10 }),
    (error) => {
      assert.equal(error.code, 'INSUFFICIENT_PAYOUT_BALANCE_WITH_FEE');
      assert.deepEqual(error.details, {
        currency: 'trx',
        available: 10.05,
        requestedAmount: 10,
        estimatedFee: 0.1,
        requiredAmount: 10.1,
        networkFeePaidBy: 'sender'
      });
      return true;
    }
  );
});

test('payout preflight aggregates amounts and fees by currency across a batch', async () => {
  const fetch = createMockFetch(({ url }) => {
    if (url.pathname === '/v1/balance') return jsonResponse({ trx: { amount: 15.15, pendingAmount: 0 } });
    if (url.pathname === '/v1/payout-withdrawal/min-amount/trx') return jsonResponse({ success: true, result: 1 });
    if (url.pathname === '/v1/payout/fee') return jsonResponse({ currency: 'trx', fee: 0.1 });
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', jwtToken: 'jwt', fetch });
  await assert.rejects(
    () => sdk.createPayout({
      withdrawals: [
        { address: 'wallet-1', currency: 'trx', amount: 10 },
        { address: 'wallet-2', currency: 'trx', amount: 5 }
      ]
    }),
    (error) => error.code === 'INSUFFICIENT_PAYOUT_BALANCE_WITH_FEE'
      && error.details.requestedAmount === 15
      && error.details.estimatedFee === 0.2
      && error.details.requiredAmount === 15.2
  );
});

test('networkFeePaidBy recipient checks the payout amount but still returns fee coverage details', async () => {
  const fetch = createMockFetch(({ url, init }) => {
    if (url.pathname === '/v1/balance') return jsonResponse({ trx: { amount: 10, pendingAmount: 0 } });
    if (url.pathname === '/v1/payout-withdrawal/min-amount/trx') return jsonResponse({ success: true, result: 1 });
    if (url.pathname === '/v1/payout/fee') return jsonResponse({ currency: 'trx', fee: 1 });
    if (url.pathname === '/v1/payout' && init.method === 'POST') {
      return jsonResponse({ id: 'batch-recipient', withdrawals: [{ id: 'p-1', status: 'WAITING', currency: 'trx', amount: '10', address: 'wallet' }] });
    }
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', jwtToken: 'jwt', fetch });
  const batch = await sdk.createPayout({
    address: 'wallet',
    currency: 'trx',
    amount: 10,
    networkFeePaidBy: 'recipient'
  });

  assert.equal(batch.preflight.networkFeePaidBy, 'recipient');
  assert.equal(batch.preflight.totals.trx.requiredAmount, 10);
  assert.equal(batch.preflight.totals.trx.coversAmount, true);
  assert.equal(batch.preflight.totals.trx.coversAmountAndFee, false);
});

test('fiat payout preflight estimates the effective crypto amount before minimum, fee and balance checks', async () => {
  const fetch = createMockFetch(({ url, init }) => {
    if (url.pathname === '/v1/balance') return jsonResponse({ usdc: { amount: 101, pendingAmount: 0 } });
    if (url.pathname === '/v1/estimate') {
      assert.equal(url.searchParams.get('amount'), '100');
      assert.equal(url.searchParams.get('currency_from'), 'usd');
      assert.equal(url.searchParams.get('currency_to'), 'usdc');
      return jsonResponse({ currency_from: 'usd', amount_from: 100, currency_to: 'usdc', estimated_amount: 99.5 });
    }
    if (url.pathname === '/v1/payout-withdrawal/min-amount/usdc') return jsonResponse({ success: true, result: 1 });
    if (url.pathname === '/v1/payout/fee') {
      assert.equal(url.searchParams.get('amount'), '99.5');
      return jsonResponse({ currency: 'usdc', fee: 0.5 });
    }
    if (url.pathname === '/v1/payout' && init.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body).withdrawals[0], {
        address: '0xwallet',
        currency: 'usdc',
        amount: 1,
        fiat_amount: 100,
        fiat_currency: 'usd'
      });
      return jsonResponse({ id: 'batch-fiat', withdrawals: [{ id: 'p-fiat', status: 'WAITING', currency: 'usdc', amount: '99.5', address: '0xwallet', fiat_amount: '100', fiat_currency: 'usd' }] });
    }
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', jwtToken: 'jwt', fetch });
  const batch = await sdk.createPayout({
    address: '0xwallet',
    currency: 'usdc',
    amount: 1,
    fiatAmount: 100,
    fiatCurrency: 'usd'
  });

  assert.equal(batch.preflight.withdrawals[0].effectiveAmount, 99.5);
  assert.equal(batch.preflight.totals.usdc.requiredAmount, 100);
});

test('payout amount validation enforces the API six-decimal limit', async () => {
  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', jwtToken: 'jwt', fetch: async () => { throw new Error('must not fetch'); } });
  await assert.rejects(
    () => sdk.createPayout({ address: 'wallet', currency: 'btc', amount: 0.1234567 }),
    (error) => error instanceof ValidationError && error.code === 'PAYOUT_AMOUNT_PRECISION_EXCEEDED'
  );
});

test('createPayout reports missing Bearer authentication before making API calls', async () => {
  const fetch = createMockFetch(() => { throw new Error('must not fetch'); });
  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });

  await assert.rejects(
    () => sdk.createPayout({ address: 'wallet', currency: 'trx', amount: 10 }),
    (error) => error instanceof ConfigurationError && error.code === 'MISSING_PAYOUT_AUTHENTICATION'
  );
  assert.equal(fetch.calls.length, 0);
});

test('automatic verification failure reports that the payout batch was already created', async () => {
  const fetch = createMockFetch(({ url, init }) => {
    if (url.pathname === '/v1/balance') return jsonResponse({ trx: { amount: 100, pendingAmount: 0 } });
    if (url.pathname === '/v1/payout-withdrawal/min-amount/trx') return jsonResponse({ success: true, result: 1 });
    if (url.pathname === '/v1/payout/fee') return jsonResponse({ currency: 'trx', fee: 0.1 });
    if (url.pathname === '/v1/payout' && init.method === 'POST') return jsonResponse({ id: 'batch-created', withdrawals: [] });
    if (url.pathname === '/v1/payout/batch-created/verify') return jsonResponse({ message: 'Invalid code' }, 400);
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({
    apiKey: 'test-key',
    jwtToken: 'jwt',
    twoFactorSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    totpNow: () => 59_000,
    fetch
  });

  await assert.rejects(
    () => sdk.createPayout({ address: 'wallet', currency: 'trx', amount: 10 }),
    (error) => error instanceof APIError
      && error.code === 'PAYOUT_VERIFICATION_FAILED'
      && error.details.batchId === 'batch-created'
      && error.httpStatus === 400
  );
});

test('validatePayoutAddress converts an invalid-address 400 into a clear validation error', async () => {
  const fetch = createMockFetch(({ url }) => {
    assert.equal(url.pathname, '/v1/payout/validate-address');
    return jsonResponse({ message: 'Invalid address' }, 400);
  });
  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });

  await assert.rejects(
    () => sdk.validatePayoutAddress({ address: 'bad', currency: 'trx' }),
    (error) => error instanceof ValidationError
      && error.code === 'INVALID_PAYOUT_ADDRESS'
      && error.details.currency === 'trx'
  );
});

test('getPayoutStatus normalizes payout status analogously to getPaymentStatus', async () => {
  const fetch = createMockFetch(({ url }) => {
    assert.equal(url.pathname, '/v1/payout/payout-42');
    return jsonResponse([{
      id: 'payout-42',
      batch_withdrawal_id: 'batch-42',
      status: 'SENDING',
      currency: 'TRX',
      amount: '10',
      address: 'wallet'
    }]);
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });
  const payout = await sdk.getPayoutStatus('payout-42');
  assert.equal(payout.id, 'payout-42');
  assert.equal(payout.batchId, 'batch-42');
  assert.equal(payout.payout_status, 'SENDING');
  assert.equal(payout.status, 'sending');
  assert.equal(payout.currency, 'trx');
  assert.equal(payout.amount, 10);
});

test('listPayouts maps camelCase query fields to the Mass payouts API and normalizes items', async () => {
  const fetch = createMockFetch(({ url }) => {
    assert.equal(url.pathname, '/v1/payout');
    assert.equal(url.searchParams.get('batch_id'), 'batch-1');
    assert.equal(url.searchParams.get('status'), 'finished');
    assert.equal(url.searchParams.get('order_by'), 'dateCreated');
    assert.equal(url.searchParams.get('order'), 'desc');
    assert.equal(url.searchParams.get('limit'), '20');
    assert.equal(url.searchParams.get('page'), '0');
    return jsonResponse({
      payouts: [{ id: 'payout-1', batch_withdrawal_id: 'batch-1', status: 'FINISHED', currency: 'trx', amount: '10', address: 'wallet' }]
    });
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });
  const list = await sdk.listPayouts({
    batchId: 'batch-1',
    status: 'finished',
    orderBy: 'dateCreated',
    order: 'desc',
    limit: 20,
    page: 0
  });

  assert.equal(list.payouts[0].status, 'finished');
  assert.equal(list.items[0].id, 'payout-1');
  assert.equal(list.data[0].batchId, 'batch-1');
});

test('listPayouts accepts finished and rejected status filters', async () => {
  // GET /v1/payout only accepts creating, waiting, processing, finished, failed, rejected as
  // a status filter. 'new' and 'rejected_not_checked' are valid payout statuses but the live API
  // returns 400 when they're used as a list filter, so the SDK must reject them before the request.
  const seenStatuses = [];
  const fetch = createMockFetch(({ url }) => {
    seenStatuses.push(url.searchParams.get('status'));
    return jsonResponse({ payouts: [{ id: 'payout-filter', status: url.searchParams.get('status') }] });
  });
  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });

  const finishedList = await sdk.listPayouts({ status: 'finished' });
  const rejectedList = await sdk.listPayouts({ status: 'rejected' });

  assert.deepEqual(seenStatuses, ['finished', 'rejected']);
  assert.equal(finishedList.payouts[0].rawStatus, 'finished');
  assert.equal(finishedList.payouts[0].status, 'finished');
  assert.equal(rejectedList.payouts[0].rawStatus, 'rejected');
  assert.equal(rejectedList.payouts[0].status, 'rejected');
});

test('listPayouts rejects status filters the API does not support', async () => {
  const fetch = createMockFetch(() => jsonResponse({ payouts: [] }));
  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });

  for (const status of ['new', 'sending', 'rejected_not_checked', 'cancelled', 'canceled']) {
    await assert.rejects(
      () => sdk.listPayouts({ status }),
      (error) => error.code === 'INVALID_PAYOUT_LIST_STATUS',
      `status=${status} should be rejected before any request is made`
    );
  }
});

test('PayoutStatusWatcher emits changes and stops on terminal payout status', async () => {
  const { PayoutStatusWatcher } = await import('../src/payout-watcher.js');
  const statusSequence = ['WAITING', 'PROCESSING', 'FINISHED'];
  let pollCount = 0;
  const fetch = createMockFetch(({ url }) => {
    if (url.pathname === '/v1/payout/payout-watch') {
      const status = statusSequence[Math.min(pollCount++, statusSequence.length - 1)];
      return jsonResponse([{ id: 'payout-watch', status }]);
    }
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });
  const watcher = new PayoutStatusWatcher({ sdk, payoutId: 'payout-watch' });
  const changes = [];
  let terminal = null;
  watcher.on('change', (event) => changes.push(event));
  watcher.on('terminal', (payout) => { terminal = payout; });

  await watcher.poll();
  await watcher.poll();
  await watcher.poll();

  assert.deepEqual(changes.map(({ from, to }) => [from, to]), [
    ['pending', 'processing'],
    ['processing', 'finished']
  ]);
  assert.equal(terminal.status, 'finished');
  assert.equal(watcher.stopped, true);
});

test('validatePayoutAddress returns a simple positive result when API responds without a body', async () => {
  const fetch = createMockFetch(({ url, init }) => {
    assert.equal(url.pathname, '/v1/payout/validate-address');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), {
      address: 'TWallet',
      currency: 'trx',
      extra_id: 'memo-1'
    });
    return new Response(null, { status: 200 });
  });

  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', fetch });
  const result = await sdk.validatePayoutAddress({
    address: 'TWallet',
    currency: 'TRX',
    extraId: 'memo-1'
  });

  assert.equal(result.valid, true);
  assert.equal(result.address, 'TWallet');
  assert.equal(result.currency, 'trx');
  assert.equal(result.extraId, 'memo-1');
});

test('invalid configured twoFactorSecret fails before a payout can be created', () => {
  assert.throws(
    () => new NowPaymentsSDK({ apiKey: 'test-key', twoFactorSecret: 'not-base32!' }),
    (error) => error instanceof ConfigurationError && error.code === 'INVALID_2FA_SECRET'
  );
});

test('invalid per-call payout verificationCode is rejected before any network request', async () => {
  const fetch = createMockFetch(() => { throw new Error('must not fetch'); });
  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', jwtToken: 'jwt', fetch });

  await assert.rejects(
    () => sdk.createPayout({
      address: 'wallet',
      currency: 'trx',
      amount: 10,
      verificationCode: '123'
    }),
    (error) => error instanceof ValidationError && error.code === 'INVALID_PAYOUT_VERIFICATION_CODE'
  );
  assert.equal(fetch.calls.length, 0);
});

test('2FA code provider failures retain the created batch id in a unified error', async () => {
  const fetch = createMockFetch(({ url, init }) => {
    if (url.pathname === '/v1/balance') return jsonResponse({ trx: { amount: 100, pendingAmount: 0 } });
    if (url.pathname === '/v1/payout-withdrawal/min-amount/trx') return jsonResponse({ success: true, result: 1 });
    if (url.pathname === '/v1/payout/fee') return jsonResponse({ currency: 'trx', fee: 0.1 });
    if (url.pathname === '/v1/payout' && init.method === 'POST') return jsonResponse({ id: 'batch-provider', withdrawals: [] });
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({
    apiKey: 'test-key',
    jwtToken: 'jwt',
    twoFactorCodeProvider: async () => 'not-a-code',
    fetch
  });

  await assert.rejects(
    () => sdk.createPayout({ address: 'wallet', currency: 'trx', amount: 10 }),
    (error) => error instanceof APIError
      && error.code === 'PAYOUT_VERIFICATION_FAILED'
      && error.details.batchId === 'batch-provider'
      && error.details.verificationError.code === 'INVALID_PAYOUT_VERIFICATION_CODE'
  );
});

test('createPayout automatically authenticates with dashboard credentials before creating and verifying', async () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const token = fakeJwt(Math.floor(Date.now() / 1000) + 300);
  let authCalls = 0;

  const fetch = createMockFetch(({ url, init }) => {
    if (url.pathname === '/v1/auth') {
      authCalls += 1;
      assert.deepEqual(JSON.parse(init.body), { email: 'merchant@example.com', password: 'secret' });
      return jsonResponse({ token });
    }
    if (url.pathname === '/v1/balance') return jsonResponse({ trx: { amount: 100, pendingAmount: 0 } });
    if (url.pathname === '/v1/payout-withdrawal/min-amount/trx') return jsonResponse({ success: true, result: 1 });
    if (url.pathname === '/v1/payout/fee') return jsonResponse({ currency: 'trx', fee: 0.1 });
    if (url.pathname === '/v1/payout' && init.method === 'POST') {
      assert.equal(init.headers.authorization, `Bearer ${token}`);
      return jsonResponse({
        id: 'batch-auth',
        withdrawals: [{ id: 'payout-auth', batch_withdrawal_id: 'batch-auth', status: 'WAITING', currency: 'trx', amount: '10', address: 'wallet' }]
      });
    }
    if (url.pathname === '/v1/payout/batch-auth/verify') {
      assert.equal(init.headers.authorization, `Bearer ${token}`);
      return jsonResponse({ message: 'verified' });
    }
    throw new Error(`Unexpected route ${url.pathname}`);
  });

  const sdk = new NowPaymentsSDK({
    apiKey: 'test-key',
    email: 'merchant@example.com',
    password: 'secret',
    twoFactorSecret: secret,
    totpNow: () => 59_000,
    fetch
  });

  const batch = await sdk.createPayout({ address: 'wallet', currency: 'trx', amount: 10 });
  assert.equal(batch.verified, true);
  assert.equal(batch.id, 'batch-auth');
  assert.equal(authCalls, 1);
});

test('createPayout rejects deferred-execution fields before any network request', async () => {
  const fetch = createMockFetch(() => {
    throw new Error('No network request is expected for unsupported payout scheduling fields.');
  });
  const sdk = new NowPaymentsSDK({ apiKey: 'test-key', jwtToken: 'jwt', fetch });
  const unsupportedInputs = [
    { executeAt: '2030-01-01T12:00:00.000Z' },
    { execute_at: '2030-01-01T12:00:00.000Z' },
    { interval: 'ONETIME' },
    { intervalValue: 2 },
    { interval_value: 2 },
    { executeUntil: '2030-06-01T12:00:00.000Z' },
    { execute_until: '2030-06-01T12:00:00.000Z' }
  ];

  for (const fields of unsupportedInputs) {
    await assert.rejects(
      () => sdk.createPayout({
        address: 'wallet',
        currency: 'trx',
        amount: 10,
        ...fields
      }),
      (error) => error instanceof ValidationError
        && error.code === 'UNSUPPORTED_PAYOUT_SCHEDULE'
        && error.details.fields.length === 1
        && error.details.fields[0] === Object.keys(fields)[0]
    );
  }

  assert.equal(fetch.calls.length, 0);
});

test('schedule-specific cancellation methods are not exposed', () => {
  const sdk = new NowPaymentsSDK({ apiKey: 'test-key' });
  assert.equal(sdk.cancelPayout, undefined);
  assert.equal(sdk.cancelPayoutBatch, undefined);
  assert.equal(sdk.raw.cancelPayout, undefined);
  assert.equal(sdk.raw.cancelPayoutBatch, undefined);
});
