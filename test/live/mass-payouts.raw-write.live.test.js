import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LIVE_RAW_PAYOUT_CONFIRMATION,
  assertWriteGate,
  assertWritePreflightWithinLimits,
  buildWritePayoutInput,
  compactObject,
  createLiveSdk,
  currentManualVerificationCode,
  diagnosticError,
  env,
  findPayoutIdByBatch,
  getRunState,
  safeError,
  updateRunState,
  wrapLiveError
} from './helpers.js';

test('NOWPayments live raw write: raw.createPayout() and raw.verifyPayout()', async (t) => {
  if (env('NOWPAYMENTS_LIVE_RAW_PAYOUT_CONFIRM') !== LIVE_RAW_PAYOUT_CONFIRMATION) {
    t.skip(
      `Raw real payout disabled. Set NOWPAYMENTS_LIVE_RAW_PAYOUT_CONFIRM=${LIVE_RAW_PAYOUT_CONFIRMATION}.`
    );
    return;
  }

  const { amount, maximumTotalDebit, runId } = assertWriteGate({ mode: 'raw', raw: true });
  const mode = 'raw';
  const previousRun = getRunState(mode, runId);
  const sdk = createLiveSdk({ includeTwoFactorSecret: false, autoVerifyPayouts: false });

  if (previousRun?.verified) {
    t.skip(
      `Run ${mode}:${runId} already created verified batch ${previousRun.batchId}. ` +
      'Change NOWPAYMENTS_LIVE_RAW_PAYOUT_RUN_ID to intentionally send another payout.'
    );
    return;
  }

  if (previousRun?.batchId) {
    try {
      const verification = await sdk.raw.verifyPayout(previousRun.batchId, {
        verification_code: currentManualVerificationCode()
      });
      // POST /v1/payout/{id}/verify responds with the plain text "OK" on success,
      // not a JSON object, so sdk.raw (a thin pass-through) legitimately returns a string here.
      assert.ok(verification == null || typeof verification === 'object' || verification === 'OK');
      const payoutId = previousRun.payoutId
        || await findPayoutIdByBatch(sdk, previousRun.batchId);
      updateRunState(mode, runId, { verified: true, payoutId });
      t.diagnostic(`Recovered and verified existing raw batch ${previousRun.batchId}; no new payout was created.`);
      return;
    } catch (error) {
      diagnosticError(t, error);
      throw wrapLiveError(`Recovery raw.verifyPayout failed for batch ${previousRun.batchId}`, error);
    }
  }

  const input = buildWritePayoutInput({ amount, runId, mode });
  let batchId = null;
  let payoutId = null;
  let verified = false;

  try {
    const addressValidation = await sdk.validatePayoutAddress({
      address: input.address,
      currency: input.currency,
      extraId: input.extraId
    });
    assert.equal(addressValidation.valid, true);

    // raw.createPayout() has no built-in SDK preflight. Run the high-level
    // checks deliberately before exercising the raw endpoint.
    const preflight = await sdk.preflightPayout(input);
    const guardedTotal = assertWritePreflightWithinLimits(preflight, input, { maximumTotalDebit });
    t.diagnostic(
      `Guarded raw debit: ${guardedTotal.requiredAmount} ${input.currency}; ` +
      `configured maximum: ${maximumTotalDebit} ${input.currency}.`
    );

    const response = await sdk.raw.createPayout(compactObject({
      ipn_callback_url: input.batchIpnCallbackUrl,
      withdrawals: [compactObject({
        address: input.address,
        currency: input.currency,
        amount: input.amount,
        extra_id: input.extraId,
        payout_description: input.payoutDescription ?? input.batchPayoutDescription,
        unique_external_id: input.uniqueExternalId
      })]
    }));

    batchId = String(response?.id ?? response?.batch_withdrawal_id ?? '').trim();
    assert.ok(batchId, 'raw.createPayout() response must contain a batch id.');
    const createdPayout = Array.isArray(response?.withdrawals)
      ? response.withdrawals.find((payout) => payout?.id ?? payout?.payout_id)
      : null;
    payoutId = createdPayout?.id ?? createdPayout?.payout_id ?? null;

    updateRunState(mode, runId, {
      batchId,
      payoutId,
      currency: input.currency,
      amount: input.amount,
      verified: false,
      createdAt: new Date().toISOString()
    });

    const verification = await sdk.raw.verifyPayout(batchId, {
      verification_code: currentManualVerificationCode()
    });
    // POST /v1/payout/{id}/verify responds with the plain text "OK" on success,
    // not a JSON object, so sdk.raw (a thin pass-through) legitimately returns a string here.
    assert.ok(verification == null || typeof verification === 'object' || verification === 'OK');
    verified = true;

    // Persist verification before list/status checks to keep retries idempotent.
    updateRunState(mode, runId, { verified: true, payoutId });

    payoutId ||= await findPayoutIdByBatch(sdk, batchId);
    assert.ok(payoutId, `No individual payout id was found for raw batch ${batchId}.`);

    const rawStatus = await sdk.raw.getPayoutStatus(payoutId);
    assert.ok(Array.isArray(rawStatus) || rawStatus == null || typeof rawStatus === 'object');

    updateRunState(mode, runId, { payoutId });
    t.diagnostic(`REAL RAW PAYOUT CREATED: batch=${batchId}, payout=${payoutId}.`);
  } catch (error) {
    if (batchId) {
      updateRunState(mode, runId, {
        batchId,
        payoutId,
        currency: input.currency,
        amount: input.amount,
        verified,
        createdAt: new Date().toISOString(),
        lastError: safeError(error)
      });
      t.diagnostic(
        verified
          ? `Verified raw batch ${batchId} already exists. Rerun with the same raw run id to skip creation.`
          : `Raw batch ${batchId} may already exist. Rerun with the same raw run id and a fresh code to avoid a duplicate.`
      );
    }
    diagnosticError(t, error);
    throw wrapLiveError('raw.createPayout/raw.verifyPayout flow failed', error);
  }
});
