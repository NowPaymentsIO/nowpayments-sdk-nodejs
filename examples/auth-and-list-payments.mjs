import { NowPaymentsSDK } from '../src/index.js';

// /v1/auth needs dashboard credentials, not an API key.
const authSdk = new NowPaymentsSDK({
  email: process.env.NOWPAYMENTS_EMAIL,
  password: process.env.NOWPAYMENTS_PASSWORD
});

const token = await authSdk.authenticate();
console.log('JWT token:', token);
console.log('JWT token from SDK instance:', authSdk.jwtToken);

// /v1/payment/ list needs both x-api-key and Bearer JWT.
const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
  jwtToken: authSdk.jwtToken
});

const payments = await sdk.listPayments({
  limit: 20,
  page: 0,
  sortBy: 'created_at',
  orderBy: 'desc'
});

console.log('Payments:', payments.data);
