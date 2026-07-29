import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  NowPaymentsSDK,
  SDK_PAYOUT_STATUSES,
  generateTotpCode
} from '../../dist/index.js';

export const LIVE_PAYOUT_CONFIRMATION = 'I_UNDERSTAND_THIS_SENDS_REAL_FUNDS';
export const LIVE_RAW_PAYOUT_CONFIRMATION = 'I_UNDERSTAND_THIS_BYPASSES_HIGH_LEVEL_CREATE_AND_SENDS_REAL_FUNDS';
export const ALL_SDK_PAYOUT_STATUSES = Object.values(SDK_PAYOUT_STATUSES);
export const EXPECTED_PREFLIGHT_BALANCE_ERRORS = new Set([
  'INSUFFICIENT_PAYOUT_BALANCE',
  'INSUFFICIENT_PAYOUT_BALANCE_WITH_FEE'
]);

function decodeDoubleQuoted(value) {
  return value.replace(/\\(n|r|t|"|\\)/g, (_, character) => {
    if (character === 'n') return '\n';
    if (character === 'r') return '\r';
    if (character === 't') return '\t';
    return character;
  });
}

function parseEnvValue(rawValue) {
  const value = rawValue.trim();
  if (value.length < 2) return value;
  if (value.startsWith('"') && value.endsWith('"')) return decodeDoubleQuoted(value.slice(1, -1));
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

/** Loads .env.live without adding dotenv. Existing process variables win. */
export function loadLiveEnv(filePath = process.env.NOWPAYMENTS_LIVE_ENV_FILE || '.env.live') {
  const absolutePath = resolve(process.cwd(), filePath);
  if (!existsSync(absolutePath)) return { loaded: false, path: absolutePath };

  const contents = readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, '');
  for (const rawLine of contents.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const line = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;

    process.env[key] = parseEnvValue(line.slice(separatorIndex + 1));
  }

  return { loaded: true, path: absolutePath };
}

loadLiveEnv();

export function env(name, fallback = undefined) {
  const value = process.env[name];
  if (value == null || value.trim() === '') return fallback;
  return value.trim();
}

export function envBoolean(name, fallback = false) {
  const value = env(name);
  if (value == null) return fallback;
  const normalized = value.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${name} must be true/false, 1/0, yes/no or on/off.`);
}

export function envNumber(name, fallback = undefined) {
  const value = env(name);
  if (value == null) return fallback;
  const numeric = Number(value);
  assert.ok(Number.isFinite(numeric), `${name} must be a finite number.`);
  return numeric;
}

export function envPositiveNumber(name, fallback = undefined) {
  const numeric = envNumber(name, fallback);
  if (numeric == null) return undefined;
  assert.ok(numeric > 0, `${name} must be a positive number.`);
  return numeric;
}

export function envPositiveInteger(name, fallback) {
  const numeric = envPositiveNumber(name, fallback);
  assert.ok(Number.isInteger(numeric), `${name} must be a positive integer.`);
  return numeric;
}

export function requiredEnv(name) {
  const value = env(name);
  assert.ok(value, `${name} is required for this live test.`);
  return value;
}

export function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

export function createLiveSdk({ includeTwoFactorSecret = true, autoVerifyPayouts } = {}) {
  const email = env('NOWPAYMENTS_EMAIL');
  const password = env('NOWPAYMENTS_PASSWORD');
  assert.ok(!(email && !password), 'NOWPAYMENTS_PASSWORD is required when NOWPAYMENTS_EMAIL is set.');
  assert.ok(!(!email && password), 'NOWPAYMENTS_EMAIL is required when NOWPAYMENTS_PASSWORD is set.');

  return new NowPaymentsSDK(compactObject({
    apiKey: env('NOWPAYMENTS_API_KEY'),
    email,
    password,
    jwtToken: env('NOWPAYMENTS_JWT_TOKEN'),
    baseUrl: env('NOWPAYMENTS_BASE_URL'),
    timeoutMs: envPositiveInteger('NOWPAYMENTS_LIVE_HTTP_TIMEOUT_MS', 30_000),
    twoFactorSecret: includeTwoFactorSecret ? env('NOWPAYMENTS_2FA_SECRET') : undefined,
    autoVerifyPayouts,
    payoutIpnCallbackUrl: env('NOWPAYMENTS_PAYOUT_IPN_URL'),
    networkFeePaidBy: env('NOWPAYMENTS_NETWORK_FEE_PAID_BY', 'sender')
  }));
}

export function payoutCurrency() {
  return env('NOWPAYMENTS_PAYOUT_CURRENCY')?.toLowerCase() || null;
}

export function payoutAddress() {
  return env('NOWPAYMENTS_PAYOUT_ADDRESS') || null;
}

export function payoutExtraId() {
  return env('NOWPAYMENTS_PAYOUT_EXTRA_ID') || undefined;
}

export function assertPayoutAuthenticationConfigured() {
  const hasAuth = Boolean(
    env('NOWPAYMENTS_JWT_TOKEN') || (env('NOWPAYMENTS_EMAIL') && env('NOWPAYMENTS_PASSWORD'))
  );
  assert.ok(
    hasAuth,
    'Configure NOWPAYMENTS_JWT_TOKEN or both NOWPAYMENTS_EMAIL and NOWPAYMENTS_PASSWORD.'
  );
}

export function assertSixDigitCode(value, source = '2FA code') {
  const code = String(value ?? '').trim();
  assert.match(code, /^\d{6}$/, `${source} must contain exactly six digits.`);
  return code;
}

export function currentManualVerificationCode() {
  const secret = env('NOWPAYMENTS_2FA_SECRET');
  if (secret) return assertSixDigitCode(generateTotpCode(secret), 'generated TOTP code');
  return assertSixDigitCode(requiredEnv('NOWPAYMENTS_2FA_CODE'), 'NOWPAYMENTS_2FA_CODE');
}

export function assertWriteGate({ mode, raw = false } = {}) {
  assertPayoutAuthenticationConfigured();
  requiredEnv('NOWPAYMENTS_API_KEY');
  requiredEnv('NOWPAYMENTS_PAYOUT_ADDRESS');
  requiredEnv('NOWPAYMENTS_PAYOUT_CURRENCY');

  const confirmationName = raw
    ? 'NOWPAYMENTS_LIVE_RAW_PAYOUT_CONFIRM'
    : 'NOWPAYMENTS_LIVE_PAYOUT_CONFIRM';
  const expectedConfirmation = raw
    ? LIVE_RAW_PAYOUT_CONFIRMATION
    : LIVE_PAYOUT_CONFIRMATION;
  assert.equal(
    env(confirmationName),
    expectedConfirmation,
    `Set ${confirmationName}=${expectedConfirmation} to enable this real-funds test.`
  );

  const amount = envPositiveNumber('NOWPAYMENTS_LIVE_PAYOUT_AMOUNT');
  const maximumAmount = envPositiveNumber('NOWPAYMENTS_LIVE_MAX_PAYOUT_AMOUNT');
  const maximumTotalDebit = envPositiveNumber('NOWPAYMENTS_LIVE_MAX_TOTAL_DEBIT');
  assert.ok(amount != null, 'NOWPAYMENTS_LIVE_PAYOUT_AMOUNT is required.');
  assert.ok(maximumAmount != null, 'NOWPAYMENTS_LIVE_MAX_PAYOUT_AMOUNT is required.');
  assert.ok(maximumTotalDebit != null, 'NOWPAYMENTS_LIVE_MAX_TOTAL_DEBIT is required.');
  assert.ok(
    amount <= maximumAmount,
    `NOWPAYMENTS_LIVE_PAYOUT_AMOUNT (${amount}) exceeds NOWPAYMENTS_LIVE_MAX_PAYOUT_AMOUNT (${maximumAmount}).`
  );
  assert.ok(
    amount <= maximumTotalDebit,
    `NOWPAYMENTS_LIVE_PAYOUT_AMOUNT (${amount}) exceeds NOWPAYMENTS_LIVE_MAX_TOTAL_DEBIT (${maximumTotalDebit}).`
  );
  assert.equal(
    Number(amount.toFixed(6)),
    amount,
    'NOWPAYMENTS_LIVE_PAYOUT_AMOUNT must have at most six decimal places.'
  );

  const runIdName = raw
    ? 'NOWPAYMENTS_LIVE_RAW_PAYOUT_RUN_ID'
    : 'NOWPAYMENTS_LIVE_PAYOUT_RUN_ID';
  const runId = requiredEnv(runIdName);
  assert.match(
    runId,
    /^[A-Za-z0-9._-]{3,48}$/,
    `${runIdName} must be 3-48 characters: letters, digits, dot, underscore or hyphen.`
  );

  if (mode === 'auto') requiredEnv('NOWPAYMENTS_2FA_SECRET');
  if (mode === 'manual' || raw) {
    assert.ok(
      env('NOWPAYMENTS_2FA_SECRET') || env('NOWPAYMENTS_2FA_CODE'),
      'Configure NOWPAYMENTS_2FA_SECRET or a fresh NOWPAYMENTS_2FA_CODE.'
    );
  }

  return { amount, maximumAmount, maximumTotalDebit, runId };
}

export function assertWritePreflightWithinLimits(preflight, input, { maximumTotalDebit }) {
  assert.equal(preflight?.skipped, false, 'The real-funds preflight must not be skipped.');
  const currency = String(input.currency).toLowerCase();
  const total = preflight?.totals?.[currency];
  assertPlainObject(total, `Preflight totals must contain ${currency}.`);
  assert.ok(Number.isFinite(total.requiredAmount), 'Preflight requiredAmount must be numeric.');
  assert.ok(
    total.requiredAmount <= maximumTotalDebit + 1e-12,
    `Preflight requires ${total.requiredAmount} ${currency}, exceeding ` +
    `NOWPAYMENTS_LIVE_MAX_TOTAL_DEBIT=${maximumTotalDebit}. ` +
    `Estimated fee: ${total.estimatedFee ?? 'unknown'} ${currency}.`
  );
  return total;
}

export function buildWritePayoutInput({ amount, runId, mode }) {
  return compactObject({
    address: requiredEnv('NOWPAYMENTS_PAYOUT_ADDRESS'),
    currency: requiredEnv('NOWPAYMENTS_PAYOUT_CURRENCY').toLowerCase(),
    amount,
    extraId: env('NOWPAYMENTS_PAYOUT_EXTRA_ID'),
    uniqueExternalId: `sdk-live-${mode}-${runId}`,
    payoutDescription: env('NOWPAYMENTS_PAYOUT_DESCRIPTION', `SDK live ${mode} payout ${runId}`),
    batchPayoutDescription: env('NOWPAYMENTS_PAYOUT_DESCRIPTION', `SDK live ${mode} payout ${runId}`),
    batchIpnCallbackUrl: env('NOWPAYMENTS_PAYOUT_IPN_URL'),
    networkFeePaidBy: env('NOWPAYMENTS_NETWORK_FEE_PAID_BY', 'sender')
  });
}

export function roundUpToSixDecimals(value) {
  const unit = 1e-6;
  const rounded = Math.ceil((Number(value) + Number.EPSILON) / unit) * unit;
  return Number(rounded.toFixed(6));
}

export function deriveProbeAmount(minimumAmount) {
  const configured = envPositiveNumber('NOWPAYMENTS_PAYOUT_PROBE_AMOUNT');
  if (configured != null) {
    assert.equal(
      Number(configured.toFixed(6)),
      configured,
      'NOWPAYMENTS_PAYOUT_PROBE_AMOUNT must have at most six decimal places.'
    );
    return configured;
  }

  assert.ok(Number.isFinite(minimumAmount) && minimumAmount >= 0, 'A valid minimum amount is required.');
  return roundUpToSixDecimals(Math.max(minimumAmount * 1.1, minimumAmount + 1e-6));
}

export function stateFilePath() {
  return resolve(
    process.cwd(),
    env('NOWPAYMENTS_LIVE_STATE_FILE', '.nowpayments-live-payout-test-state.json')
  );
}

export function readLiveState() {
  const path = stateFilePath();
  if (!existsSync(path)) return { version: 1, runs: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return {
      version: 1,
      runs: parsed?.runs && typeof parsed.runs === 'object' ? parsed.runs : {}
    };
  } catch (error) {
    throw new Error(`Cannot parse live payout state file ${path}: ${error.message}`);
  }
}

export function stateKey(mode, runId) {
  return `${mode}:${runId}`;
}

export function getRunState(mode, runId) {
  return readLiveState().runs[stateKey(mode, runId)] || null;
}

export function updateRunState(mode, runId, patch) {
  const path = stateFilePath();
  const state = readLiveState();
  const key = stateKey(mode, runId);
  state.runs[key] = {
    ...(state.runs[key] || {}),
    mode,
    runId,
    ...patch,
    updatedAt: new Date().toISOString()
  };

  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

export function latestStatePayoutId() {
  const runs = Object.values(readLiveState().runs);
  runs.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  for (const run of runs) {
    if (run?.payoutId) return String(run.payoutId);
  }
  return null;
}

export function payoutIdFromBatch(batch) {
  const withdrawals = batch?.withdrawals || batch?.items || [];
  return withdrawals.find((item) => item?.id)?.id || null;
}

export async function findPayoutIdByBatch(
  sdk,
  batchId,
  attempts = envPositiveInteger('NOWPAYMENTS_LIVE_EVENTUAL_ATTEMPTS', 12)
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const list = await sdk.listPayouts({ batchId, limit: 20, page: 0 });
    const payoutId = list.payouts.find((payout) => payout.id)?.id;
    if (payoutId) return payoutId;
    if (attempt < attempts - 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, envPositiveInteger(
        'NOWPAYMENTS_LIVE_EVENTUAL_INTERVAL_MS',
        1000
      )));
    }
  }
  return null;
}

export async function resolveExistingPayoutId(sdk) {
  const explicit = env('NOWPAYMENTS_EXISTING_PAYOUT_ID');
  if (explicit) return explicit;

  const statePayoutId = latestStatePayoutId();
  if (statePayoutId) return statePayoutId;

  const list = await sdk.listPayouts({ orderBy: 'dateCreated', order: 'desc', limit: 1, page: 0 });
  return list.payouts.find((payout) => payout.id)?.id || null;
}

export async function waitForFirstWatcherResult(sdk, payoutId) {
  const timeoutMs = envPositiveInteger('NOWPAYMENTS_LIVE_WATCH_TIMEOUT_MS', 20_000);
  const intervalMs = envPositiveInteger('NOWPAYMENTS_LIVE_WATCH_INTERVAL_MS', 1000);

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const watcher = sdk.watchPayoutStatus(payoutId, {
      intervalMs,
      timeoutMs,
      terminalStatuses: ALL_SDK_PAYOUT_STATUSES
    });

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      watcher.stop();
      callback(value);
    };

    watcher.once('terminal', (payout) => finish(resolvePromise, { payout, watcher }));
    watcher.once('timeout', () => finish(
      rejectPromise,
      new Error(`watchPayoutStatus timed out after ${timeoutMs} ms for payout ${payoutId}.`)
    ));
    watcher.once('error', (error) => finish(rejectPromise, error));
  });
}

export async function waitForPayoutStatusCallback(sdk, payoutId) {
  const timeoutMs = envPositiveInteger('NOWPAYMENTS_LIVE_WATCH_TIMEOUT_MS', 20_000);
  const intervalMs = envPositiveInteger('NOWPAYMENTS_LIVE_WATCH_INTERVAL_MS', 1000);

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let unsubscribe = () => {};
    let capturedWatcher = null;
    const originalWatchPayoutStatus = sdk.watchPayoutStatus;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      callback(value);
    };

    const timeout = setTimeout(() => finish(
      rejectPromise,
      new Error(`onPayoutStatusChange timed out after ${timeoutMs} ms for payout ${payoutId}.`)
    ), timeoutMs + 1000);

    sdk.watchPayoutStatus = function captureWatcher(...argumentsList) {
      capturedWatcher = originalWatchPayoutStatus.apply(this, argumentsList);
      return capturedWatcher;
    };

    try {
      unsubscribe = sdk.onPayoutStatusChange(
        payoutId,
        (event) => finish(resolvePromise, event),
        {
          intervalMs,
          timeoutMs,
          terminalStatuses: ALL_SDK_PAYOUT_STATUSES
        }
      );
    } finally {
      sdk.watchPayoutStatus = originalWatchPayoutStatus;
    }

    capturedWatcher?.once('timeout', () => finish(
      rejectPromise,
      new Error(`onPayoutStatusChange watcher timed out after ${timeoutMs} ms for payout ${payoutId}.`)
    ));
    capturedWatcher?.once('error', (error) => finish(rejectPromise, error));
  });
}

export function assertPlainObject(value, message = 'Expected an object.') {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), message);
}

export function assertBalanceShape(balance) {
  assertPlainObject(balance, 'Balance must be an object keyed by currency.');
  for (const [currency, entry] of Object.entries(balance)) {
    assert.equal(currency, currency.toLowerCase(), `Balance currency ${currency} must be lowercase.`);
    assertPlainObject(entry, `Balance entry for ${currency} must be an object.`);
    assert.ok(entry.amount == null || Number.isFinite(entry.amount), `${currency}.amount must be numeric or null.`);
    assert.ok(
      entry.pendingAmount == null || Number.isFinite(entry.pendingAmount),
      `${currency}.pendingAmount must be numeric or null.`
    );
  }
}

export function assertPayoutShape(payout, expectedId = undefined) {
  assertPlainObject(payout, 'Payout must be an object.');
  assert.ok(typeof payout.status === 'string', 'Payout must contain a normalized status.');
  assert.ok(ALL_SDK_PAYOUT_STATUSES.includes(payout.status), `Unexpected payout status: ${payout.status}`);
  if (expectedId != null) assert.equal(String(payout.id), String(expectedId));
  assert.ok(payout.id == null || typeof payout.id === 'string', 'Payout id must be a string or null.');
  assert.ok(payout.amount == null || Number.isFinite(payout.amount), 'Payout amount must be numeric or null.');
}

export function safeError(error) {
  if (typeof error?.toJSON === 'function') return error.toJSON();
  return {
    name: error?.name,
    code: error?.code,
    message: error?.message,
    httpStatus: error?.httpStatus,
    requestId: error?.requestId,
    details: error?.details
  };
}

export function wrapLiveError(label, error) {
  const wrapped = new Error(`${label}: ${JSON.stringify(safeError(error), null, 2)}`);
  wrapped.cause = error;
  return wrapped;
}

export function diagnosticError(t, error) {
  t.diagnostic(JSON.stringify(safeError(error), null, 2));
}

export function verboseDiagnostic(t, label, value) {
  if (envBoolean('NOWPAYMENTS_LIVE_VERBOSE')) {
    t.diagnostic(`${label}: ${JSON.stringify(value, null, 2)}`);
  }
}
