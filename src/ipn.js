import crypto from 'node:crypto';
import { ConfigurationError, ValidationError } from './errors.js';
import { normalizePayment } from './normalizers.js';
import { isNonEmptyString } from './validators.js';

export function sortObjectDeep(value) {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = sortObjectDeep(value[key]);
      return result;
    }, {});
  }
  return value;
}

export function createWebhookSignature(payload, secret) {
  if (!isNonEmptyString(secret)) {
    throw new ConfigurationError('IPN secret is required to create webhook signature.', {
      code: 'MISSING_IPN_SECRET'
    });
  }
  if (payload == null || typeof payload !== 'object') {
    throw new ValidationError('Webhook payload must be an object.', {
      code: 'INVALID_WEBHOOK_PAYLOAD'
    });
  }

  return crypto
    .createHmac('sha512', secret.trim())
    .update(JSON.stringify(sortObjectDeep(payload)))
    .digest('hex');
}

export function verifyWebhookSignature(payload, signature, secret) {
  if (!isNonEmptyString(signature)) {
    return false;
  }
  const expected = createWebhookSignature(payload, secret);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(String(signature).trim(), 'hex');

  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export function normalizeWebhook(payload = {}) {
  if ('payment_id' in payload || 'payment_status' in payload) {
    return {
      type: 'payment.status_changed',
      payment: normalizePayment(payload)
    };
  }

  return {
    type: 'unknown',
    data: null
  };
}
