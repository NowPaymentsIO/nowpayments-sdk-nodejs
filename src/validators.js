import { ConfigurationError, ValidationError } from './errors.js';

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
  const amount = input.amount ?? input.priceAmount;
  const currency = input.currency ?? input.priceCurrency;
  assertPositiveNumber(amount, 'amount');
  const normalized = {
    ...input,
    amount,
    currency: cleanCurrency(currency, 'currency')
  };

  if (normalized.payCurrency != null) normalized.payCurrency = cleanCurrency(normalized.payCurrency, 'payCurrency');
  if (normalized.payoutCurrency != null) normalized.payoutCurrency = cleanCurrency(normalized.payoutCurrency, 'payoutCurrency');

  assertOptionalUrl(normalized.ipnCallbackUrl, 'ipnCallbackUrl');
  assertOptionalUrl(normalized.successUrl, 'successUrl');
  assertOptionalUrl(normalized.cancelUrl, 'cancelUrl');
  assertOptionalUrl(normalized.partiallyPaidUrl, 'partiallyPaidUrl');

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
  const fromCurrency = cleanCurrency(input.fromCurrency ?? input.currencyFrom, 'fromCurrency');
  const toCurrency = cleanCurrency(input.toCurrency ?? input.currencyTo, 'toCurrency');
  return { amount, fromCurrency, toCurrency };
}

export function validateMinimumInput(input = {}) {
  const fromCurrency = cleanCurrency(input.fromCurrency ?? input.currencyFrom, 'fromCurrency');
  const toCurrency = input.toCurrency ?? input.currencyTo;
  return {
    ...input,
    fromCurrency,
    toCurrency: toCurrency == null || toCurrency === '' ? undefined : cleanCurrency(toCurrency, 'toCurrency')
  };
}

export function validateInvoicePaymentInput(input = {}) {
  const invoiceId = input.invoiceId ?? input.iid;
  assertString(invoiceId, 'invoiceId');
  const payCurrency = cleanCurrency(input.payCurrency, 'payCurrency');
  return { ...input, invoiceId: String(invoiceId), payCurrency };
}

export function validatePaymentId(paymentId) {
  assertString(String(paymentId ?? ''), 'paymentId');
  return String(paymentId);
}
