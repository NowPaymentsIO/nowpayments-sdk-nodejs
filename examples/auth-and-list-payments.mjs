import { NowPaymentsSDK } from '../src/index.js';

// Bearer JWT is handled under the hood when email + password are provided.
// The first Bearer-protected request authenticates automatically, then the SDK
// caches the JWT in memory and refreshes it when it expires.
const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  email: process.env.NOWPAYMENTS_EMAIL,
  password: process.env.NOWPAYMENTS_PASSWORD
});

const payments = await sdk.listPayments({
  limit: 20,
  page: 0,
  sortBy: 'created_at',
  orderBy: 'desc'
});

console.log('Payments:', payments.data);

// Optional: the cached token is still available for debugging/advanced flows.
console.log('Cached JWT token:', sdk.jwtToken);
