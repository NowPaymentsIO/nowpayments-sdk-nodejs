import { NowPaymentsSDK, isSDKError } from '../dist/index.js';

const code = process.env.NOWPAYMENTS_2FA_CODE;
if (!code) {
  throw new Error('Set NOWPAYMENTS_2FA_CODE to the current six-digit code before running this example.');
}

// No twoFactorSecret is configured in this example.
const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  email: process.env.NOWPAYMENTS_EMAIL,
  password: process.env.NOWPAYMENTS_PASSWORD,
  payoutIpnCallbackUrl: process.env.NOWPAYMENTS_PAYOUT_IPN_URL
});

try {
  const batch = await sdk.createPayout({
    address: process.env.NOWPAYMENTS_PAYOUT_ADDRESS,
    currency: process.env.NOWPAYMENTS_PAYOUT_CURRENCY || 'trx',
    amount: Number(process.env.NOWPAYMENTS_PAYOUT_AMOUNT || 10),
    payoutDescription: 'SDK manual 2FA example'
  });

  console.log('Batch created:', batch.id);
  console.log('Requires verification:', batch.requiresVerification);

  const verification = await sdk.verifyPayout(batch.id, code);
  console.log('Verified:', verification.verified);
} catch (error) {
  console.error(isSDKError(error) ? error.toJSON() : error);
  process.exitCode = 1;
}
