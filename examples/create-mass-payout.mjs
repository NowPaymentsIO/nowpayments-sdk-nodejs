import { NowPaymentsSDK, isSDKError } from '../dist/index.js';

const twoFactorSecret = process.env.NOWPAYMENTS_2FA_SECRET;
if (!twoFactorSecret) {
  throw new Error('Set NOWPAYMENTS_2FA_SECRET before running the mass payout example.');
}

const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  email: process.env.NOWPAYMENTS_EMAIL,
  password: process.env.NOWPAYMENTS_PASSWORD,
  twoFactorSecret
});

try {
  const batch = await sdk.createPayout({
    payoutDescription: 'July affiliate settlement',
    ipnCallbackUrl: process.env.NOWPAYMENTS_PAYOUT_IPN_URL,
    withdrawals: [
      {
        address: process.env.NOWPAYMENTS_PAYOUT_ADDRESS,
        currency: 'trx',
        amount: 10,
        uniqueExternalId: 'affiliate-1001'
      },
      {
        address: process.env.NOWPAYMENTS_PAYOUT_ADDRESS,
        currency: 'trx',
        amount: 12.5,
        uniqueExternalId: 'affiliate-1002'
      }
    ]
  });

  console.log('Batch:', batch.id);
  console.table(batch.withdrawals.map((payout) => ({
    id: payout.id,
    currency: payout.currency,
    amount: payout.amount,
    status: payout.status
  })));
} catch (error) {
  console.error(isSDKError(error) ? error.toJSON() : error);
  process.exitCode = 1;
}
