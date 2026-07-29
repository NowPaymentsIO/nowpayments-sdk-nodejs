import { createHmac } from 'node:crypto';
import { ValidationError } from './errors.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SUPPORTED_ALGORITHMS = new Set(['sha1', 'sha256', 'sha512']);

function extractSecret(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError('twoFactorSecret must be a non-empty Base32 secret.', {
      code: 'INVALID_2FA_SECRET'
    });
  }

  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith('otpauth://')) return trimmed;

  try {
    const url = new URL(trimmed);
    const secret = url.searchParams.get('secret');
    if (!secret) throw new Error('missing secret');
    return secret;
  } catch (error) {
    throw new ValidationError('twoFactorSecret contains an invalid otpauth URI.', {
      code: 'INVALID_2FA_SECRET',
      cause: error
    });
  }
}

function decodeBase32(value) {
  const normalized = extractSecret(value)
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/=+$/g, '');

  if (!normalized || [...normalized].some((character) => !BASE32_ALPHABET.includes(character))) {
    throw new ValidationError('twoFactorSecret must be a valid Base32 secret.', {
      code: 'INVALID_2FA_SECRET'
    });
  }

  let bits = '';
  for (const character of normalized) {
    bits += BASE32_ALPHABET.indexOf(character).toString(2).padStart(5, '0');
  }

  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  if (bytes.length === 0) {
    throw new ValidationError('twoFactorSecret is too short to generate a TOTP code.', {
      code: 'INVALID_2FA_SECRET'
    });
  }

  return Buffer.from(bytes);
}

function normalizePositiveInteger(value, fallback, fieldName, { min = 1, max } = {}) {
  const numeric = value == null ? fallback : Number(value);
  if (!Number.isInteger(numeric) || numeric < min || (max != null && numeric > max)) {
    throw new ValidationError(`${fieldName} must be an integer between ${min} and ${max ?? 'Infinity'}.`, {
      code: 'INVALID_TOTP_CONFIGURATION',
      details: { field: fieldName, value }
    });
  }
  return numeric;
}

/**
 * Generates an RFC 6238 TOTP code from a Base32 secret.
 * The defaults match authenticator applications commonly used by NOWPayments:
 * SHA-1, 6 digits and a 30-second period.
 */
export function generateTotpCode(secret, options = {}) {
  const algorithm = String(options.algorithm ?? 'sha1').toLowerCase().replace('-', '');
  if (!SUPPORTED_ALGORITHMS.has(algorithm)) {
    throw new ValidationError('algorithm must be sha1, sha256 or sha512.', {
      code: 'INVALID_TOTP_CONFIGURATION',
      details: { field: 'algorithm', value: options.algorithm }
    });
  }

  const period = normalizePositiveInteger(options.period, 30, 'period');
  const digits = normalizePositiveInteger(options.digits, 6, 'digits', { min: 6, max: 10 });
  const timestamp = options.timestamp == null ? Date.now() : Number(options.timestamp);

  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new ValidationError('timestamp must be a non-negative number of milliseconds.', {
      code: 'INVALID_TOTP_CONFIGURATION',
      details: { field: 'timestamp', value: options.timestamp }
    });
  }

  const counter = BigInt(Math.floor(timestamp / 1000 / period));
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);

  const digest = createHmac(algorithm, decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  ) >>> 0;

  return String(binary % (10 ** digits)).padStart(digits, '0');
}
