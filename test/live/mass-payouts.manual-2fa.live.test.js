import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LIVE_PAYOUT_CONFIRMATION,
  assertPayoutShape,
  assertWriteGate,
  assertWritePreflightWithinLimits,
  buildWritePayoutInput,
  createLiveSdk,
  currentManualVerificationCode,
  diagnosticError,
  env,
  findPayoutIdByBatch,
  getRunState,
  payoutIdFromBatch,
  safeError,
  updateRunState,
  wrapLiveError
} from './helpers.js';

test('NOWPayments live write: createPayout() without secret then explicit verifyPayout()', async (t) => {
  if (env('NOWPAYMENTS_LIVE_PAYOUT_CONFIRM') !== LIVE_PAYOUT_CONFIRMATION) {
    t.skip(
      `Real payout disabled. Set NOWPAYMENTS_LIVE_PAYOUT_CONFIRM=${LIVE_PAYOUT_CONFIRMATION}.`
    );
    return;
  }

  const { amount, maximumTotalDebit, runId } = assertWriteGate({ mode: 'manual' });
  const mode = 'manual';
  const previousRun = getRunState(mode, runId);
  const sdk = createLiveSdk({ includeTwoFactorSecret: false, autoVerifyPayouts: false });

  if (previousRun?.verified) {
    t.skip(
      `Run ${mode}:${runId} already created verified batch ${previousRun.batchId}. ` +
      'Change NOWPAYMENTS_LIVE_PAYOUT_RUN_ID to intentionally send another payout.'
    );
    return;
  }

  if (previousRun?.batchId) {
    try {
      const verification = await sdk.verifyPayout(
        previousRun.batchId,
        currentManualVerificationCode()
      );
      assert.equal(verification.verified, true);
      const payoutId = previousRun.payoutId
        || await findPayoutIdByBatch(sdk, previousRun.batchId);
      updateRunState(mode, runId, { verified: true, payoutId });
      t.diagnostic(`Recovered and verified existing batch ${previousRun.batchId}; no new payout was created.`);
      return;
    } catch (error) {
      diagnosticError(t, error);
      throw wrapLiveError(`Recovery verifyPayout failed for batch ${previousRun.batchId}`, error);
    }
  }

  const input = buildWritePayoutInput({ amount, runId, mode });
  let batch = null;
  let payoutId = null;
  let verified = false;

  try {
    const addressValidation = await sdk.validatePayoutAddress({
      address: input.address,
      currency: input.currency,
      extraId: input.extraId
    });
    assert.equal(addressValidation.valid, true);

    const guardedPreflight = await sdk.preflightPayout(input);
    const guardedTotal = assertWritePreflightWithinLimits(guardedPreflight, input, { maximumTotalDebit });
    t.diagnostic(
      `Guarded debit: ${guardedTotal.requiredAmount} ${input.currency}; ` +
      `configured maximum: ${maximumTotalDebit} ${input.currency}.`
    );

    batch = await sdk.createPayout({ ...input, autoVerify: false });
    assert.ok(batch.id, 'createPayout() must return a batch id.');
    assert.equal(batch.verified, false);
    assert.equal(batch.requiresVerification, true);
    assert.equal(batch.preflight?.skipped, false);

    payoutId = payoutIdFromBatch(batch);

    // Persist before verification. A retry with the same run id verifies this
    // batch instead of creating a second payout when the code expires.
    updateRunState(mode, runId, {
      batchId: batch.id,
      payoutId,
      currency: input.currency,
      amount: input.amount,
      verified: false,
      createdAt: new Date().toISOString()
    });

    const verification = await sdk.verifyPayout(batch.id, currentManualVerificationCode());
    assert.equal(verification.verified, true);
    verified = true;

    // Mark the batch verified before any eventually-consistent list/status call.
    updateRunState(mode, runId, { verified: true, payoutId });

    payoutId ||= await findPayoutIdByBatch(sdk, batch.id);
    assert.ok(payoutId, `No individual payout id was found for batch ${batch.id}.`);

    const payout = await sdk.getPayoutStatus(payoutId);
    assertPayoutShape(payout, payoutId);

    updateRunState(mode, runId, {
      payoutId,
      status: payout.status
    });
    t.diagnostic(`REAL PAYOUT CREATED: batch=${batch.id}, payout=${payoutId}, status=${payout.status}.`);
  } catch (error) {
    const batchId = batch?.id || error?.details?.batchId;
    if (batchId) {
      updateRunState(mode, runId, {
        batchId: String(batchId),
        payoutId,
        currency: input.currency,
        amount: input.amount,
        verified,
        createdAt: new Date().toISOString(),
        lastError: safeError(error)
      });
      t.diagnostic(
        verified
          ? `Verified batch ${batchId} already exists. Rerun with the same run id to skip creation.`
          : `Batch ${batchId} may already exist. Rerun with the same run id and a fresh code to verify it without creating a duplicate.`
      );
    }
    diagnosticError(t, error);
    throw wrapLiveError('Manual createPayout/verifyPayout flow failed', error);
  }
});
