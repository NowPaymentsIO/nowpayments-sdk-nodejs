import { NowPaymentsSDK } from '../dist/index.js';

const payoutId = process.argv[2];
if (!payoutId) throw new Error('Usage: node examples/watch-payout-status.mjs <payout-id>');

const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY
});

const payout = await sdk.getPayoutStatus(payoutId);
console.log('Current status:', payout.payout_status, '->', payout.status);

const watcher = sdk.watchPayoutStatus(payoutId, {
  intervalMs: 5000,
  timeoutMs: 30 * 60 * 1000
});

watcher.on('change', ({ from, to, payout: updated }) => {
  console.log(`${from} -> ${to}`, updated.id);
});

watcher.on('terminal', (finalPayout) => {
  console.log('Final status:', finalPayout.status);
});

watcher.on('timeout', ({ payoutId: timedOutId }) => {
  console.warn('Polling timed out for', timedOutId);
});

watcher.on('error', console.error);
