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
