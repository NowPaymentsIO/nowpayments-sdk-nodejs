import { NowPaymentsSDK, isSDKError } from '../dist/index.js';

const twoFactorSecret = process.env.NOWPAYMENTS_2FA_SECRET;
if (!twoFactorSecret) {
  throw new Error('Set NOWPAYMENTS_2FA_SECRET before running the automatic 2FA example.');
}

const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  email: process.env.NOWPAYMENTS_EMAIL,
  password: process.env.NOWPAYMENTS_PASSWORD,
  twoFactorSecret,
  payoutIpnCallbackUrl: process.env.NOWPAYMENTS_PAYOUT_IPN_URL
});

try {
  // A single withdrawal object is enough. The SDK wraps it in the API's
  // withdrawals array, checks balance/minimum/fee, creates the batch and
  // immediately verifies it with a generated TOTP code.
  const batch = await sdk.createPayout({
    address: process.env.NOWPAYMENTS_PAYOUT_ADDRESS,
    currency: process.env.NOWPAYMENTS_PAYOUT_CURRENCY || 'trx',
    amount: Number(process.env.NOWPAYMENTS_PAYOUT_AMOUNT || 10),
    uniqueExternalId: `example-${Date.now()}`,
    payoutDescription: 'SDK automatic 2FA example'
  });

  console.log('Batch:', batch.id);
  console.log('Verified:', batch.verified);
  console.log('Payout:', batch.withdrawals[0]?.id);
  console.log('Preflight totals:', batch.preflight?.totals);
} catch (error) {
  console.error(isSDKError(error) ? error.toJSON() : error);
  process.exitCode = 1;
}
