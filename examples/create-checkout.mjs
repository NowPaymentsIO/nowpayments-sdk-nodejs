import { NowPaymentsSDK } from '../src/index.js';

const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET,
  ipnCallbackUrl: process.env.NOWPAYMENTS_IPN_URL,
  successUrl: process.env.NOWPAYMENTS_REDIRECT_SUCCESS,
  cancelUrl: process.env.NOWPAYMENTS_REDIRECT_CANCEL,
});

const checkout = await sdk.createPayment({
  amount: 2.99,
  currency: 'usd',
  payCurrency: 'xrp',
  orderId: 'order-' + Math.ceil(Math.random() * 100000000),
  description: 'Demo order'
});

console.log('Redirect customer to:', checkout.checkoutUrl);
console.log('SDK session:', checkout);
