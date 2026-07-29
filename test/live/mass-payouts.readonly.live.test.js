import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EXPECTED_PREFLIGHT_BALANCE_ERRORS,
  assertBalanceShape,
  assertPlainObject,
  assertPayoutShape,
  compactObject,
  createLiveSdk,
  deriveProbeAmount,
  diagnosticError,
  env,
  payoutAddress,
  payoutCurrency,
  payoutExtraId,
  resolveExistingPayoutId,
  verboseDiagnostic,
  waitForFirstWatcherResult,
  waitForPayoutStatusCallback,
  wrapLiveError
} from './helpers.js';

function skip(t, reason) {
  t.skip(reason);
}

function firstRawPayout(response, payoutId) {
  const withdrawals = Array.isArray(response)
    ? response
    : Array.isArray(response?.withdrawals)
      ? response.withdrawals
      : Array.isArray(response?.payouts)
        ? response.payouts
        : null;
  if (withdrawals) {
    if (payoutId != null) {
      const match = withdrawals.find((item) => String(item?.id ?? item?.payout_id) === String(payoutId));
      if (match) return match;
    }
    return withdrawals[0] || null;
  }
  return response && typeof response === 'object' ? response : null;
}

test('NOWPayments Mass payouts live read-only integration', async (t) => {
  if (!env('NOWPAYMENTS_API_KEY')) {
    skip(t, 'NOWPAYMENTS_API_KEY is not configured. Copy .env.live.example to .env.live.');
    return;
  }

  const sdk = createLiveSdk();
  const currency = payoutCurrency();
  const address = payoutAddress();
  const extraId = payoutExtraId();
  const networkFeePaidBy = env('NOWPAYMENTS_NETWORK_FEE_PAID_BY', 'sender');

  let normalizedBalance = null;
  let minimum = null;
  let probeAmount = null;
  let normalizedList = null;
  let payoutId = null;
  let payoutForWebhook = null;

  await t.test('public high-level and raw Mass payouts methods are exposed', () => {
    for (const method of [
      'getBalance',
      'getPayoutBalance',
      'validatePayoutAddress',
      'getPayoutFeeEstimate',
      'getMinimumPayoutAmount',
      'preflightPayout',
      'createPayout',
      'verifyPayout',
      'getPayoutStatus',
      'listPayouts',
      'watchPayoutStatus',
      'onPayoutStatusChange'
    ]) {
      assert.equal(typeof sdk[method], 'function', `sdk.${method} must be a function.`);
    }

    for (const method of [
      'getBalance',
      'validatePayoutAddress',
      'getPayoutFee',
      'getMinimumPayoutAmount',
      'createPayout',
      'verifyPayout',
      'getPayoutStatus',
      'listPayouts'
    ]) {
      assert.equal(typeof sdk.raw[method], 'function', `sdk.raw.${method} must be a function.`);
    }
  });

  await t.test('getBalance() returns normalized real custody balances', async (subtest) => {
    try {
      normalizedBalance = await sdk.getBalance();
      assertBalanceShape(normalizedBalance);
      subtest.diagnostic(`Currencies returned: ${Object.keys(normalizedBalance).length}`);
      verboseDiagnostic(subtest, 'normalized balance', normalizedBalance);
    } catch (error) {
      diagnosticError(subtest, error);
      throw wrapLiveError('getBalance failed', error);
    }
  });

  await t.test('getPayoutBalance() returns the same normalized shape', async (subtest) => {
    try {
      const payoutBalance = await sdk.getPayoutBalance();
      assertBalanceShape(payoutBalance);

      if (normalizedBalance && Object.keys(normalizedBalance).length && Object.keys(payoutBalance).length) {
        assert.deepEqual(
          Object.keys(payoutBalance).sort(),
          Object.keys(normalizedBalance).sort(),
          'getBalance and getPayoutBalance should expose the same currency keys.'
        );
      }
    } catch (error) {
      diagnosticError(subtest, error);
      throw wrapLiveError('getPayoutBalance failed', error);
    }
  });

  await t.test('validatePayoutAddress() validates the configured real address', async (subtest) => {
    if (!currency || !address) {
      skip(subtest, 'Set NOWPAYMENTS_PAYOUT_CURRENCY and NOWPAYMENTS_PAYOUT_ADDRESS.');
      return;
    }

    try {
      const result = await sdk.validatePayoutAddress(compactObject({ currency, address, extraId }));
      assert.equal(result.valid, true);
      assert.equal(result.currency, currency);
      assert.equal(result.address, address);
      assert.equal(result.extraId, extraId ?? null);
    } catch (error) {
      diagnosticError(subtest, error);
      throw wrapLiveError('validatePayoutAddress failed', error);
    }
  });

  await t.test('getMinimumPayoutAmount() returns the current real minimum', async (subtest) => {
    if (!currency) {
      skip(subtest, 'Set NOWPAYMENTS_PAYOUT_CURRENCY.');
      return;
    }

    try {
      minimum = await sdk.getMinimumPayoutAmount(currency);
      assert.equal(minimum.success, true);
      assert.equal(minimum.currency, currency);
      assert.ok(Number.isFinite(minimum.result) && minimum.result >= 0);
      probeAmount = deriveProbeAmount(minimum.result);
      assert.ok(probeAmount >= minimum.result);
      subtest.diagnostic(`Current ${currency} minimum: ${minimum.result}; probe amount: ${probeAmount}`);
    } catch (error) {
      diagnosticError(subtest, error);
      throw wrapLiveError('getMinimumPayoutAmount failed', error);
    }
  });

  await t.test('getPayoutFeeEstimate() returns a current real fee estimate', async (subtest) => {
    if (!currency || probeAmount == null) {
      skip(subtest, 'Currency/minimum is unavailable; configure NOWPAYMENTS_PAYOUT_CURRENCY.');
      return;
    }

    try {
      const fee = await sdk.getPayoutFeeEstimate({ currency, amount: probeAmount });
      assert.equal(fee.currency, currency);
      assert.equal(fee.amount, probeAmount);
      assert.ok(Number.isFinite(fee.fee) && fee.fee >= 0);
      assert.equal(fee.estimatedFee, fee.fee);
      subtest.diagnostic(`Estimated ${currency} network fee: ${fee.fee}`);
    } catch (error) {
      diagnosticError(subtest, error);
      throw wrapLiveError('getPayoutFeeEstimate failed', error);
    }
  });

  await t.test('preflightPayout() checks real balance, minimum and fee without creating a payout', async (subtest) => {
    if (!currency || !address || probeAmount == null) {
      skip(subtest, 'Set NOWPAYMENTS_PAYOUT_CURRENCY and NOWPAYMENTS_PAYOUT_ADDRESS.');
      return;
    }

    try {
      const preflight = await sdk.preflightPayout(compactObject({
        currency,
        address,
        amount: probeAmount,
        extraId,
        networkFeePaidBy
      }));

      assert.equal(preflight.skipped, false);
      assertBalanceShape(preflight.balance);
      assert.equal(preflight.withdrawals.length, 1);
      assert.equal(preflight.withdrawals[0].currency, currency);
      assert.equal(preflight.withdrawals[0].requestedAmount, probeAmount);
      assert.ok(Number.isFinite(preflight.withdrawals[0].minimum.result));
      assert.ok(Number.isFinite(preflight.withdrawals[0].fee.fee));

      const total = preflight.totals[currency];
      assertPlainObject(total, `Preflight totals must contain ${currency}.`);
      assert.equal(total.coversAmount, true);
      verboseDiagnostic(subtest, 'preflight total', total);
    } catch (error) {
      if (EXPECTED_PREFLIGHT_BALANCE_ERRORS.has(error?.code)) {
        assert.equal(error.details?.currency, currency);
        assert.ok(Number.isFinite(error.details?.available));
        assert.ok(Number.isFinite(error.details?.requiredAmount));
        subtest.diagnostic(
          `Preflight correctly rejected insufficient ${currency} balance: ` +
          `${error.details.available} available, ${error.details.requiredAmount} required.`
        );
        return;
      }
      diagnosticError(subtest, error);
      throw wrapLiveError('preflightPayout failed', error);
    }
  });

  await t.test('listPayouts() returns normalized real payout history', async (subtest) => {
    try {
      normalizedList = await sdk.listPayouts({
        orderBy: 'dateCreated',
        order: 'desc',
        limit: 20,
        page: 0
      });

      assert.ok(Array.isArray(normalizedList.payouts));
      assert.equal(normalizedList.items, normalizedList.payouts);
      assert.equal(normalizedList.data, normalizedList.payouts);
      for (const payout of normalizedList.payouts) assertPayoutShape(payout);
      payoutId = normalizedList.payouts.find((payout) => payout.id)?.id || null;
      subtest.diagnostic(`Payouts returned: ${normalizedList.payouts.length}`);
    } catch (error) {
      diagnosticError(subtest, error);
      throw wrapLiveError('listPayouts failed', error);
    }
  });

  await t.test('listPayouts() accepts finished and rejected status filters', async (subtest) => {
    // GET /v1/payout only accepts creating, waiting, processing, finished, failed, rejected as a status filter.
    // 'new' and 'rejected_not_checked' are valid payout statuses but return 400 when used as a list filter.
    for (const status of ['finished', 'rejected']) {
      try {
        const list = await sdk.listPayouts({ status, limit: 5, page: 0 });
        assert.ok(Array.isArray(list.payouts));
        for (const payout of list.payouts) assertPayoutShape(payout);
        subtest.diagnostic(`${status}: ${list.payouts.length} payout(s)`);
      } catch (error) {
        diagnosticError(subtest, error);
        throw wrapLiveError(`listPayouts status=${status} failed`, error);
      }
    }
  });

  await t.test('getPayoutStatus() returns a real normalized payout', async (subtest) => {
    try {
      payoutId ||= await resolveExistingPayoutId(sdk);
      if (!payoutId) {
        skip(subtest, 'No payout id is available. Set NOWPAYMENTS_EXISTING_PAYOUT_ID or run a write test.');
        return;
      }

      payoutForWebhook = await sdk.getPayoutStatus(payoutId);
      assertPayoutShape(payoutForWebhook, payoutId);
      subtest.diagnostic(
        `Payout ${payoutForWebhook.id}: raw=${payoutForWebhook.payout_status}, normalized=${payoutForWebhook.status}`
      );
    } catch (error) {
      diagnosticError(subtest, error);
      throw wrapLiveError(`getPayoutStatus failed for ${payoutId}`, error);
    }
  });

  await t.test('watchPayoutStatus() performs a real poll and emits terminal', async (subtest) => {
    if (!payoutId) {
      skip(subtest, 'No payout id is available. Set NOWPAYMENTS_EXISTING_PAYOUT_ID or run a write test.');
      return;
    }

    try {
      const { payout, watcher } = await waitForFirstWatcherResult(sdk, payoutId);
      assertPayoutShape(payout, payoutId);
      assert.equal(watcher.stopped, true);
    } catch (error) {
      diagnosticError(subtest, error);
      throw wrapLiveError('watchPayoutStatus failed', error);
    }
  });

  await t.test('onPayoutStatusChange() performs a real poll and invokes the callback', async (subtest) => {
    if (!payoutId) {
      skip(subtest, 'No payout id is available. Set NOWPAYMENTS_EXISTING_PAYOUT_ID or run a write test.');
      return;
    }

    try {
      const event = await waitForPayoutStatusCallback(sdk, payoutId);
      assert.equal(event.from, null);
      assert.equal(event.to, event.payout.status);
      assertPayoutShape(event.payout, payoutId);
    } catch (error) {
      diagnosticError(subtest, error);
      throw wrapLiveError('onPayoutStatusChange failed', error);
    }
  });

  await t.test('parseWebhook() recognizes a payout payload built from real payout data', async (subtest) => {
    if (!payoutForWebhook) {
      skip(subtest, 'No real payout data is available for webhook normalization.');
      return;
    }

    const payload = {
      id: payoutForWebhook.id,
      batch_withdrawal_id: payoutForWebhook.batchId,
      status: payoutForWebhook.rawStatus || payoutForWebhook.status,
      currency: payoutForWebhook.currency,
      amount: payoutForWebhook.amount,
      address: payoutForWebhook.address,
      hash: payoutForWebhook.hash,
      created_at: payoutForWebhook.created_at,
      updated_at: payoutForWebhook.updated_at
    };
    const event = sdk.parseWebhook(payload, undefined, { verify: false });
    assert.equal(event.type, 'payout.status_changed');
    assert.equal(event.payout.id, payoutForWebhook.id);
    assert.equal(event.payout.status, payoutForWebhook.status);
  });

  await t.test('sdk.raw read methods return real API responses', async (subtest) => {
    try {
      const rawBalance = await sdk.raw.getBalance();
      assertPlainObject(rawBalance, 'raw.getBalance() must return an object.');

      const rawList = await sdk.raw.listPayouts({ order_by: 'dateCreated', order: 'desc', limit: 2, page: 0 });
      assert.ok(Array.isArray(rawList) || rawList == null || typeof rawList === 'object');

      if (currency) {
        const rawMinimum = await sdk.raw.getMinimumPayoutAmount(currency);
        assertPlainObject(rawMinimum, 'raw.getMinimumPayoutAmount() must return an object.');
        assert.ok(Number.isFinite(Number(rawMinimum.result ?? rawMinimum.min_amount)));

        const rawProbeAmount = probeAmount ?? deriveProbeAmount(Number(rawMinimum.result ?? rawMinimum.min_amount));
        const rawFee = await sdk.raw.getPayoutFee({ currency, amount: rawProbeAmount });
        assertPlainObject(rawFee, 'raw.getPayoutFee() must return an object.');
        assert.ok(Number.isFinite(Number(rawFee.fee)) && Number(rawFee.fee) >= 0);
      }

      if (currency && address) {
        const rawAddress = await sdk.raw.validatePayoutAddress({
          address,
          currency,
          extra_id: extraId ?? null
        });
        // POST /v1/payout/validate-address responds with the plain text "OK" on success,
        // not a JSON object, so sdk.raw (a thin pass-through) legitimately returns a string here.
        assert.ok(rawAddress == null || typeof rawAddress === 'object' || rawAddress === 'OK');
      }

      if (payoutId) {
        const rawStatus = await sdk.raw.getPayoutStatus(payoutId);
        const rawPayout = firstRawPayout(rawStatus, payoutId);
        assert.ok(rawPayout == null || typeof rawPayout === 'object');
        if (rawPayout?.id != null) assert.equal(String(rawPayout.id), String(payoutId));
      }

      verboseDiagnostic(subtest, 'raw payout list', rawList);
    } catch (error) {
      diagnosticError(subtest, error);
      throw wrapLiveError('sdk.raw read methods failed', error);
    }
  });
});
