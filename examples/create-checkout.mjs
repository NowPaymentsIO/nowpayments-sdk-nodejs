import { NowPaymentsSDK } from '../src/index.js';

const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET,
  ipnCallbackUrl: 'https://example.com/webhooks/nowpayments',
  successUrl: 'https://example.com/payment/success',
  cancelUrl: 'https://example.com/payment/cancel'
});

// Hosted checkout is backed by NOWPayments POST /v1/invoice.
// That is why the response is invoice-shaped and has invoice_url, not payment_status.
const checkout = await sdk.createCheckout({
  amount: 49.99,
  currency: 'usd',
  payCurrency: 'btc',
  orderId: 'order-1001',
  description: 'Demo order'
});

console.log('Invoice ID:', checkout.id);
console.log('Redirect customer to:', checkout.invoice_url);

if (checkout.estimate) {
  console.log(
    `Estimated payment: ${checkout.estimate.estimated_amount} ${checkout.estimate.currency_to}`
  );
}

if (checkout.minimum) {
  console.log(
    `Minimum payment: ${checkout.minimum.min_amount} ${checkout.minimum.currency_from}`
  );
}
