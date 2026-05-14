import http from 'node:http';
import { NowPaymentsSDK } from '../src/index.js';

const sdk = new NowPaymentsSDK({
  apiKey: process.env.NOWPAYMENTS_API_KEY,
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

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhooks/nowpayments') {
    res.writeHead(404).end();
    return;
  }

  try {
    const payload = await readJson(req);
    const signature = req.headers['x-nowpayments-sig'];
    const event = sdk.parseWebhook(payload, String(signature || ''));

    if (event.type === 'payment.status_changed') {
      console.log('Payment status:', event.payment.id, event.payment.status);
      // Update your order in the database here.
    }

    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
  } catch (error) {
    console.error(error);
    res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false }));
  }
});

server.listen(3000, () => {
  console.log('Webhook server is listening on http://localhost:3000/webhooks/nowpayments');
});
