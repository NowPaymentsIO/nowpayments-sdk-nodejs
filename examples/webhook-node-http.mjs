import http from 'node:http';
import { NowPaymentsSDK } from '../src/index.js';

const sdk = new NowPaymentsSDK({
  ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET
});

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

// Use this URL as ipnCallbackUrl when creating checkout/payment:
// https://your-domain.com/webhooks/nowpayments
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhooks/nowpayments') {
    res.writeHead(404).end();
    return;
  }

  try {
    const payload = await readJson(req);
    const signature = req.headers['x-nowpayments-sig'];

    // parseWebhook verifies x-nowpayments-sig and returns a normalized event.
    const event = sdk.parseWebhook(payload, String(signature || ''));

    if (event.type === 'payment.status_changed') {
      const payment = event.payment;
      console.log('Payment status:', payment.payment_id, payment.payment_status, '->', payment.status);

      // Update your order in the database here.
      // Usually you match it by payment.order_id, payment.purchase_id, or payment.invoice_id.
    }

    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
  } catch (error) {
    console.error(error);
    res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false }));
  }
});

server.listen(3000, () => {
  console.log('Webhook endpoint: http://localhost:3000/webhooks/nowpayments');
  console.log('Use a public HTTPS URL for production IPN callbacks.');
});
