import { ConfigurationError, ValidationError } from './errors.js';

const PAYMENT_LIST_SORT_FIELDS = new Set([
  'created_at',
  'updated_at',
  'payment_id',
  'payment_status',
  'pay_address',
  'price_amount',
  'price_currency',
  'pay_amount',
  'actually_paid',
  'pay_currency',
  'order_id',
  'order_description',
  'purchase_id',
  'outcome_amount',
  'outcome_currency'
]);

export function assertConfiguredApiKey(apiKey) {
  if (!isNonEmptyString(apiKey)) {
    throw new ConfigurationError('NOWPayments API key is required. Pass { apiKey } to the SDK constructor.', {
      code: 'MISSING_API_KEY'
    });
  }
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function assertPositiveNumber(value, fieldName) {
  if (!isPositiveNumber(value)) {
    throw new ValidationError(`${fieldName} must be a positive number.`, {
      code: 'INVALID_AMOUNT',
      details: { field: fieldName }
    });
  }
}

export function assertString(value, fieldName) {
  if (!isNonEmptyString(value)) {
    throw new ValidationError(`${fieldName} is required and must be a non-empty string.`, {
      code: 'INVALID_STRING',
      details: { field: fieldName }
    });
  }
}

export function assertOptionalUrl(value, fieldName) {
  if (value == null || value === '') return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw new ValidationError(`${fieldName} must be a valid http(s) URL.`, {
      code: 'INVALID_URL',
      details: { field: fieldName }
    });
  }
}

export function cleanCurrency(value, fieldName) {
  assertString(value, fieldName);
  return value.trim().toLowerCase();
}

export function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined)
  );
}

export function validateCheckoutInput(input = {}) {
  const amount = input.amount ?? input.priceAmount ?? input.price_amount;
  const currency = input.currency ?? input.priceCurrency ?? input.price_currency;
  assertPositiveNumber(amount, 'amount');
  const normalized = {
    ...input,
    amount,
    currency: cleanCurrency(currency, 'currency')
  };

  const payCurrency = input.payCurrency ?? input.pay_currency;
  const payoutCurrency = input.payoutCurrency ?? input.payout_currency;

  if (payCurrency != null) normalized.payCurrency = cleanCurrency(payCurrency, 'payCurrency');
  if (payoutCurrency != null) normalized.payoutCurrency = cleanCurrency(payoutCurrency, 'payoutCurrency');

  assertOptionalUrl(normalized.ipnCallbackUrl ?? normalized.ipn_callback_url, 'ipnCallbackUrl');
  assertOptionalUrl(normalized.successUrl ?? normalized.success_url, 'successUrl');
  assertOptionalUrl(normalized.cancelUrl ?? normalized.cancel_url, 'cancelUrl');
  assertOptionalUrl(normalized.partiallyPaidUrl ?? normalized.partially_paid_url, 'partiallyPaidUrl');

  if (!normalized.ipnCallbackUrl && normalized.ipn_callback_url) normalized.ipnCallbackUrl = normalized.ipn_callback_url;
  if (!normalized.successUrl && normalized.success_url) normalized.successUrl = normalized.success_url;
  if (!normalized.cancelUrl && normalized.cancel_url) normalized.cancelUrl = normalized.cancel_url;
  if (!normalized.partiallyPaidUrl && normalized.partially_paid_url) normalized.partiallyPaidUrl = normalized.partially_paid_url;

  return normalized;
}

export function validateDirectPaymentInput(input = {}) {
  const normalized = validateCheckoutInput(input);
  if (!normalized.payCurrency) {
    throw new ValidationError('payCurrency is required for direct payments.', {
      code: 'MISSING_PAY_CURRENCY',
      details: { field: 'payCurrency' }
    });
  }
  if (normalized.payoutAddress != null && normalized.payoutAddress !== '') {
    assertString(normalized.payoutAddress, 'payoutAddress');
  }
  return normalized;
}

export function validateEstimateInput(input = {}) {
  const amount = input.amount;
  assertPositiveNumber(amount, 'amount');
  const fromCurrency = cleanCurrency(input.fromCurrency ?? input.currencyFrom ?? input.currency_from, 'fromCurrency');
  const toCurrency = cleanCurrency(input.toCurrency ?? input.currencyTo ?? input.currency_to, 'toCurrency');
  return { amount, fromCurrency, toCurrency };
}

export function validateMinimumInput(input = {}) {
  const fromCurrency = cleanCurrency(input.fromCurrency ?? input.currencyFrom ?? input.currency_from, 'fromCurrency');
  const toCurrency = input.toCurrency ?? input.currencyTo ?? input.currency_to;
  return {
    ...input,
    fromCurrency,
    toCurrency: toCurrency == null || toCurrency === '' ? undefined : cleanCurrency(toCurrency, 'toCurrency')
  };
}

export function validateInvoicePaymentInput(input = {}) {
  const invoiceId = input.invoiceId ?? input.iid;
  assertString(invoiceId, 'invoiceId');
  const payCurrency = cleanCurrency(input.payCurrency ?? input.pay_currency, 'payCurrency');
  return { ...input, invoiceId: String(invoiceId), payCurrency };
}

export function validatePaymentId(paymentId) {
  assertString(String(paymentId ?? ''), 'paymentId');
  return String(paymentId);
}

function normalizeInteger(value, fieldName, { min, max } = {}) {
  if (value == null || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || (min != null && numeric < min) || (max != null && numeric > max)) {
    throw new ValidationError(`${fieldName} must be an integer${min == null ? '' : ` >= ${min}`}${max == null ? '' : ` and <= ${max}`}.`, {
      code: 'INVALID_PAYMENT_LIST_QUERY',
      details: { field: fieldName, value }
    });
  }
  return numeric;
}

function normalizePayoutInteger(value, fieldName, { min, max } = {}) {
  if (value == null || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || (min != null && numeric < min) || (max != null && numeric > max)) {
    throw new ValidationError(`${fieldName} must be an integer${min == null ? '' : ` >= ${min}`}${max == null ? '' : ` and <= ${max}`}.`, {
      code: 'INVALID_PAYOUT_INPUT',
      details: { field: fieldName, value, min, max }
    });
  }
  return numeric;
}

function normalizeOptionalBoolean(value, fieldName) {
  if (value == null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw new ValidationError(`${fieldName} must be a boolean.`, {
    code: 'INVALID_PAYOUT_INPUT',
    details: { field: fieldName, value }
  });
}

function normalizeSortBy(value) {
  if (value == null || value === '') return undefined;
  const normalized = String(value).trim();
  if (!PAYMENT_LIST_SORT_FIELDS.has(normalized)) {
    throw new ValidationError('sortBy has an unsupported value for payment list.', {
      code: 'INVALID_PAYMENT_LIST_SORT_BY',
      details: {
        field: 'sortBy',
        value,
        allowed: Array.from(PAYMENT_LIST_SORT_FIELDS)
      }
    });
  }
  return normalized;
}

function normalizeOrderBy(value) {
  if (value == null || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'asc' || normalized === 'desc') return normalized;
  return null;
}

export function validatePaymentsListQuery(query = {}) {
  let sortBy = query.sortBy ?? query.sort_by;
  let orderBy = query.orderBy ?? query.order_by;
  const normalizedOrderBy = normalizeOrderBy(orderBy);

  // Common integration mistake: orderBy/order_by receives a field name such as
  // "created_at". NOWPayments expects this field under sortBy and can respond
  // with a 500. We correct this only when sortBy was not provided.
  if (orderBy != null && normalizedOrderBy === null) {
    const possibleSortBy = String(orderBy).trim();
    if (sortBy == null && PAYMENT_LIST_SORT_FIELDS.has(possibleSortBy)) {
      sortBy = possibleSortBy;
      orderBy = undefined;
    } else {
      throw new ValidationError('orderBy accepts only asc or desc. Use sortBy for fields such as created_at.', {
        code: 'INVALID_PAYMENT_LIST_ORDER_BY',
        details: {
          field: 'orderBy',
          value: orderBy,
          allowed: ['asc', 'desc'],
          hint: 'Use sortBy for the sorting field and orderBy for asc/desc.'
        }
      });
    }
  }

  return compactObject({
    limit: normalizeInteger(query.limit, 'limit', { min: 1, max: 500 }),
    page: normalizeInteger(query.page, 'page', { min: 0 }),
    sortBy: normalizeSortBy(sortBy),
    orderBy: normalizedOrderBy === null ? undefined : normalizedOrderBy,
    dateFrom: query.dateFrom ?? query.date_from,
    dateTo: query.dateTo ?? query.date_to,
    invoiceId: query.invoiceId ?? query.invoice_id
  });
}

const PAYOUT_LIST_ORDER_FIELDS = new Set([
  'id',
  'batchId',
  'dateCreated',
  'dateRequested',
  'dateUpdated',
  'currency',
  'status'
]);

// GET /v1/payout only accepts these six values as a `status` filter.
// Other payout statuses (new, sending, rejected_not_checked, cancelled/canceled, etc.)
// can appear on individual payout objects, but the API rejects them as a list filter with a 400.
const PAYOUT_LIST_STATUSES = new Set([
  'creating',
  'waiting',
  'processing',
  'finished',
  'failed',
  'rejected'
]);

const UNSUPPORTED_PAYOUT_SCHEDULE_FIELDS = Object.freeze([
  'executeAt',
  'execute_at',
  'interval',
  'intervalValue',
  'interval_value',
  'executeUntil',
  'execute_until'
]);

const NETWORK_FEE_POLICIES = new Set(['sender', 'recipient']);

function countDecimalPlaces(value) {
  const text = String(value).trim().toLowerCase();
  if (!text.includes('e')) {
    return (text.split('.')[1] || '').replace(/0+$/, '').length;
  }

  const [coefficient, exponentText] = text.split('e');
  const exponent = Number(exponentText);
  const fractionalLength = (coefficient.split('.')[1] || '').replace(/0+$/, '').length;
  return Math.max(0, fractionalLength - exponent);
}

function normalizePayoutAmount(value, fieldName, { maxDecimals } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new ValidationError(`${fieldName} must be a positive finite number.`, {
      code: 'INVALID_PAYOUT_AMOUNT',
      details: { field: fieldName, value }
    });
  }

  if (maxDecimals != null && countDecimalPlaces(value) > maxDecimals) {
    throw new ValidationError(`${fieldName} must not contain more than ${maxDecimals} decimal places.`, {
      code: 'PAYOUT_AMOUNT_PRECISION_EXCEEDED',
      details: { field: fieldName, value, maxDecimals }
    });
  }

  return numeric;
}

function normalizeNullableString(value, fieldName) {
  if (value == null || value === '') return null;
  assertString(value, fieldName);
  return String(value).trim();
}

function assertPayoutScheduleNotUsed(source) {
  const fields = UNSUPPORTED_PAYOUT_SCHEDULE_FIELDS.filter((field) => {
    const value = source[field];
    return value !== undefined && value !== null && value !== '';
  });

  if (fields.length > 0) {
    throw new ValidationError('Scheduled and recurring payouts are not supported in this SDK release.', {
      code: 'UNSUPPORTED_PAYOUT_SCHEDULE',
      details: { fields }
    });
  }
}

function validatePayoutWithdrawal(input, index, defaults = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError(`withdrawals[${index}] must be an object.`, {
      code: 'INVALID_PAYOUT_WITHDRAWAL',
      details: { field: `withdrawals[${index}]` }
    });
  }

  const address = input.address;
  const currency = input.currency;
  const amount = input.amount;
  assertString(address, `withdrawals[${index}].address`);

  const normalized = {
    address: String(address).trim(),
    currency: cleanCurrency(currency, `withdrawals[${index}].currency`),
    amount: normalizePayoutAmount(amount, `withdrawals[${index}].amount`, { maxDecimals: 6 })
  };

  const extraId = input.extraId ?? input.extra_id;
  const ipnCallbackUrl = input.ipnCallbackUrl ?? input.ipn_callback_url ?? defaults.ipnCallbackUrl;
  const payoutDescription = input.payoutDescription ?? input.payout_description ?? defaults.payoutDescription;
  const uniqueExternalId = input.uniqueExternalId ?? input.unique_external_id;
  const fiatAmount = input.fiatAmount ?? input.fiat_amount;
  const fiatCurrency = input.fiatCurrency ?? input.fiat_currency;

  if (extraId !== undefined) normalized.extraId = normalizeNullableString(extraId, `withdrawals[${index}].extraId`);
  if (ipnCallbackUrl != null && ipnCallbackUrl !== '') {
    assertOptionalUrl(ipnCallbackUrl, `withdrawals[${index}].ipnCallbackUrl`);
    normalized.ipnCallbackUrl = String(ipnCallbackUrl);
  }
  if (payoutDescription != null && payoutDescription !== '') {
    assertString(payoutDescription, `withdrawals[${index}].payoutDescription`);
    normalized.payoutDescription = String(payoutDescription);
  }
  if (uniqueExternalId != null && uniqueExternalId !== '') {
    assertString(uniqueExternalId, `withdrawals[${index}].uniqueExternalId`);
    normalized.uniqueExternalId = String(uniqueExternalId);
  }
  if (fiatAmount != null && fiatAmount !== '') {
    normalized.fiatAmount = normalizePayoutAmount(fiatAmount, `withdrawals[${index}].fiatAmount`);
    normalized.fiatCurrency = cleanCurrency(fiatCurrency, `withdrawals[${index}].fiatCurrency`);
  } else if (fiatCurrency != null && fiatCurrency !== '') {
    throw new ValidationError(`withdrawals[${index}].fiatAmount is required when fiatCurrency is set.`, {
      code: 'MISSING_PAYOUT_FIAT_AMOUNT',
      details: { field: `withdrawals[${index}].fiatAmount` }
    });
  }

  return normalized;
}

export function validateNetworkFeePaidBy(value = 'sender') {
  const normalized = String(value ?? 'sender').trim().toLowerCase();
  const canonical = normalized === 'receiver' ? 'recipient' : normalized;
  if (!NETWORK_FEE_POLICIES.has(canonical)) {
    throw new ValidationError('networkFeePaidBy must be sender or recipient.', {
      code: 'INVALID_PAYOUT_FEE_POLICY',
      details: { field: 'networkFeePaidBy', value, allowed: Array.from(NETWORK_FEE_POLICIES) }
    });
  }
  return canonical;
}

/**
 * Accepts either the API-style batch object, a single withdrawal object, or an
 * array of withdrawals. The output is a stable camelCase representation used
 * internally by the high-level SDK.
 */
export function validatePayoutCreateInput(input = {}) {
  const source = Array.isArray(input) ? { withdrawals: input } : input;
  if (!source || typeof source !== 'object') {
    throw new ValidationError('Payout input must be an object or an array of withdrawals.', {
      code: 'INVALID_PAYOUT_INPUT'
    });
  }

  assertPayoutScheduleNotUsed(source);

  const hasWithdrawalArray = Array.isArray(source.withdrawals);
  const batchIpnCallbackUrl = hasWithdrawalArray
    ? source.ipnCallbackUrl ?? source.ipn_callback_url
    : source.batchIpnCallbackUrl ?? source.batch_ipn_callback_url;
  const batchPayoutDescription = hasWithdrawalArray
    ? source.payoutDescription ?? source.payout_description
    : source.batchPayoutDescription ?? source.batch_payout_description;
  assertOptionalUrl(batchIpnCallbackUrl, 'ipnCallbackUrl');
  if (batchPayoutDescription != null && batchPayoutDescription !== '') {
    assertString(batchPayoutDescription, 'payoutDescription');
  }

  const withdrawalInputs = hasWithdrawalArray ? source.withdrawals : [source];

  if (withdrawalInputs.length === 0) {
    throw new ValidationError('withdrawals must contain at least one payout.', {
      code: 'EMPTY_PAYOUT_BATCH',
      details: { field: 'withdrawals' }
    });
  }

  const withdrawals = withdrawalInputs.map((withdrawal, index) => validatePayoutWithdrawal(withdrawal, index, {
    // Batch-level fields are sent at batch level. Do not duplicate them on each
    // withdrawal unless the user explicitly set a withdrawal-level value.
    ipnCallbackUrl: undefined,
    payoutDescription: undefined
  }));

  const preflightConcurrencyValue = source.preflightConcurrency ?? source.preflight_concurrency;
  const preflightConcurrency = preflightConcurrencyValue == null
    ? undefined
    : normalizePayoutInteger(preflightConcurrencyValue, 'preflightConcurrency', { min: 1, max: 25 });
  const verificationCode = source.verificationCode ?? source.verification_code;
  const networkFeePaidBy = source.networkFeePaidBy ?? source.network_fee_paid_by;

  return compactObject({
    withdrawals,
    ipnCallbackUrl: batchIpnCallbackUrl == null || batchIpnCallbackUrl === '' ? undefined : String(batchIpnCallbackUrl),
    payoutDescription: batchPayoutDescription == null || batchPayoutDescription === '' ? undefined : String(batchPayoutDescription),
    skipPreflight: normalizeOptionalBoolean(source.skipPreflight ?? source.skip_preflight, 'skipPreflight') ?? false,
    autoVerify: normalizeOptionalBoolean(source.autoVerify ?? source.auto_verify, 'autoVerify'),
    verificationCode: verificationCode == null || verificationCode === ''
      ? undefined
      : validatePayoutVerificationCode(verificationCode),
    networkFeePaidBy: networkFeePaidBy == null || networkFeePaidBy === ''
      ? undefined
      : validateNetworkFeePaidBy(networkFeePaidBy),
    preflightConcurrency
  });
}

export function validatePayoutAddressInput(input = {}) {
  assertString(input.address, 'address');
  return compactObject({
    address: String(input.address).trim(),
    currency: cleanCurrency(input.currency, 'currency'),
    extraId: normalizeNullableString(input.extraId ?? input.extra_id, 'extraId')
  });
}

export function validatePayoutFeeInput(input = {}) {
  return {
    currency: cleanCurrency(input.currency, 'currency'),
    amount: normalizePayoutAmount(input.amount, 'amount')
  };
}

export function validateMinimumPayoutCurrency(input) {
  const currency = typeof input === 'string' ? input : input?.currency ?? input?.coin;
  return cleanCurrency(currency, 'currency');
}

function validatePayoutIdentifier(value, fieldName) {
  const stringValue = String(value ?? '').trim();
  assertString(stringValue, fieldName);
  return stringValue;
}

export function validatePayoutId(payoutId) {
  return validatePayoutIdentifier(payoutId, 'payoutId');
}

export function validatePayoutBatchId(batchId) {
  return validatePayoutIdentifier(batchId, 'batchId');
}

export function validatePayoutVerificationCode(code) {
  const normalized = String(code ?? '').trim();
  if (!/^\d{6}$/.test(normalized)) {
    throw new ValidationError('verificationCode must contain exactly 6 digits.', {
      code: 'INVALID_PAYOUT_VERIFICATION_CODE',
      details: { field: 'verificationCode' }
    });
  }
  return normalized;
}

function normalizePayoutListOrderField(value) {
  if (value == null || value === '') return undefined;
  const normalized = String(value).trim();
  if (!PAYOUT_LIST_ORDER_FIELDS.has(normalized)) {
    throw new ValidationError('orderBy has an unsupported value for payout list.', {
      code: 'INVALID_PAYOUT_LIST_ORDER_BY',
      details: { field: 'orderBy', value, allowed: Array.from(PAYOUT_LIST_ORDER_FIELDS) }
    });
  }
  return normalized;
}

function normalizePayoutListOrder(value) {
  if (value == null || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (normalized !== 'asc' && normalized !== 'desc') {
    throw new ValidationError('order must be asc or desc.', {
      code: 'INVALID_PAYOUT_LIST_ORDER',
      details: { field: 'order', value, allowed: ['asc', 'desc'] }
    });
  }
  return normalized;
}

function normalizePayoutListStatus(value) {
  if (value == null || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (!PAYOUT_LIST_STATUSES.has(normalized)) {
    throw new ValidationError('status has an unsupported payout value.', {
      code: 'INVALID_PAYOUT_LIST_STATUS',
      details: { field: 'status', value, allowed: Array.from(PAYOUT_LIST_STATUSES) }
    });
  }
  return normalized;
}

export function validatePayoutsListQuery(query = {}) {
  const batchId = query.batchId ?? query.batch_id;
  return compactObject({
    batchId: batchId == null || batchId === '' ? undefined : validatePayoutBatchId(batchId),
    status: normalizePayoutListStatus(query.status),
    orderBy: normalizePayoutListOrderField(query.orderBy ?? query.order_by),
    order: normalizePayoutListOrder(query.order),
    dateFrom: query.dateFrom ?? query.date_from,
    dateTo: query.dateTo ?? query.date_to,
    limit: normalizePayoutInteger(query.limit, 'limit', { min: 1, max: 500 }),
    page: normalizePayoutInteger(query.page, 'page', { min: 0 })
  });
}
