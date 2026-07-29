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

test('NOWPayments live write: createPayout() automatically verifies with twoFactorSecret', async (t) => {
  if (env('NOWPAYMENTS_LIVE_PAYOUT_CONFIRM') !== LIVE_PAYOUT_CONFIRMATION) {
    t.skip(
      `Real payout disabled. Set NOWPAYMENTS_LIVE_PAYOUT_CONFIRM=${LIVE_PAYOUT_CONFIRMATION}.`
    );
    return;
  }

  const { amount, maximumTotalDebit, runId } = assertWriteGate({ mode: 'auto' });
  const mode = 'auto';
  const previousRun = getRunState(mode, runId);

  if (previousRun?.verified) {
    t.skip(
      `Run ${mode}:${runId} already created verified batch ${previousRun.batchId}. ` +
      'Change NOWPAYMENTS_LIVE_PAYOUT_RUN_ID to intentionally send another payout.'
    );
    return;
  }

  if (previousRun?.batchId) {
    const recoverySdk = createLiveSdk({ includeTwoFactorSecret: false, autoVerifyPayouts: false });
    try {
      const verification = await recoverySdk.verifyPayout(
        previousRun.batchId,
        currentManualVerificationCode()
      );
      assert.equal(verification.verified, true);
      const payoutId = previousRun.payoutId
        || await findPayoutIdByBatch(recoverySdk, previousRun.batchId);
      updateRunState(mode, runId, { verified: true, payoutId });
      t.diagnostic(`Recovered and verified existing batch ${previousRun.batchId}; no new payout was created.`);
      return;
    } catch (error) {
      diagnosticError(t, error);
      throw wrapLiveError(`Recovery verifyPayout failed for batch ${previousRun.batchId}`, error);
    }
  }

  const sdk = createLiveSdk({ includeTwoFactorSecret: true, autoVerifyPayouts: true });
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

    let verifyMethodCalls = 0;
    const originalVerifyPayout = sdk.verifyPayout.bind(sdk);
    sdk.verifyPayout = (...argumentsList) => {
      verifyMethodCalls += 1;
      return originalVerifyPayout(...argumentsList);
    };

    batch = await sdk.createPayout(input);
    assert.ok(batch.id, 'createPayout() must return a batch id.');
    assert.equal(batch.verified, true);
    assert.equal(batch.requiresVerification, false);
    assert.equal(batch.verification?.verified, true);
    assert.equal(batch.preflight?.skipped, false);
    assert.equal(verifyMethodCalls, 1, 'createPayout() must call verifyPayout() once under the hood.');
    verified = true;

    payoutId = payoutIdFromBatch(batch);

    // Persist the verified batch immediately. If the subsequent status lookup
    // fails, rerunning this test must never create or re-verify the payout.
    updateRunState(mode, runId, {
      batchId: batch.id,
      payoutId,
      currency: input.currency,
      amount: input.amount,
      verified: true,
      createdAt: new Date().toISOString()
    });

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
          : `Batch ${batchId} may already exist. Rerun with the same run id to verify that batch instead of creating a duplicate.`
      );
    }
    diagnosticError(t, error);
    throw wrapLiveError('Automatic createPayout/verifyPayout flow failed', error);
  }
});
