import { NowPaymentsSDK } from '../src/index.js';

const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET,
  ipnCallbackUrl: 'https://example.com/webhooks/nowpayments'
});

const payment = await sdk.createDirectPayment({
  amount: 100,
  currency: 'usd',
  payCurrency: 'trx',
  orderId: 'order-1002'
});

console.log('Payment ID:', payment.payment_id);
console.log('Payment ID alias:', payment.id);
console.log('Status:', payment.payment_status, '->', payment.status);
console.log('Send funds to:', payment.pay_address);
console.log('Memo/extra id:', payment.payin_extra_id);
