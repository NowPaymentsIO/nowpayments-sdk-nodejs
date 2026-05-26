export const SDK_PAYMENT_STATUSES = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  PAID: 'paid',
  PARTIALLY_PAID: 'partially_paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  UNKNOWN: 'unknown'
});

const PAYMENT_STATUS_MAP = Object.freeze({
  waiting: SDK_PAYMENT_STATUSES.PENDING,
  confirming: SDK_PAYMENT_STATUSES.PROCESSING,
  confirmed: SDK_PAYMENT_STATUSES.PROCESSING,
  sending: SDK_PAYMENT_STATUSES.PROCESSING,
  partially_paid: SDK_PAYMENT_STATUSES.PARTIALLY_PAID,
  finished: SDK_PAYMENT_STATUSES.PAID,
  failed: SDK_PAYMENT_STATUSES.FAILED,
  refunded: SDK_PAYMENT_STATUSES.REFUNDED,
  expired: SDK_PAYMENT_STATUSES.EXPIRED,
  cancelled: SDK_PAYMENT_STATUSES.CANCELLED,
  canceled: SDK_PAYMENT_STATUSES.CANCELLED
});

export const TERMINAL_PAYMENT_STATUSES = Object.freeze([
  SDK_PAYMENT_STATUSES.PAID,
  SDK_PAYMENT_STATUSES.PARTIALLY_PAID,
  SDK_PAYMENT_STATUSES.FAILED,
  SDK_PAYMENT_STATUSES.REFUNDED,
  SDK_PAYMENT_STATUSES.EXPIRED,
  SDK_PAYMENT_STATUSES.CANCELLED
]);

export function normalizePaymentStatus(apiStatus) {
  if (!apiStatus || typeof apiStatus !== 'string') return SDK_PAYMENT_STATUSES.UNKNOWN;
  return PAYMENT_STATUS_MAP[apiStatus.toLowerCase()] || SDK_PAYMENT_STATUSES.UNKNOWN;
}

function withAliases(target, aliases) {
  for (const [key, value] of Object.entries(aliases)) {
    if (key in target) continue;
    Object.defineProperty(target, key, {
      value,
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
  return target;
}

function toStringOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function toLowerStringOrNull(value) {
  return toStringOrNull(value)?.toLowerCase() ?? null;
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toBooleanOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return Boolean(value);
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function copyIfPresent(source, target, keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined) target[key] = source[key];
  }
}

export function normalizeEstimate(api = {}) {
  const estimate = {
    currency_from: toLowerStringOrNull(api.currency_from),
    amount_from: toNumberOrNull(api.amount_from),
    currency_to: toLowerStringOrNull(api.currency_to),
    estimated_amount: toNumberOrNull(api.estimated_amount)
  };

  return withAliases(estimate, {
    fromCurrency: estimate.currency_from,
    amountFrom: estimate.amount_from,
    toCurrency: estimate.currency_to,
    estimatedAmount: estimate.estimated_amount,
    from: {
      amount: estimate.amount_from,
      currency: estimate.currency_from
    },
    to: {
      amount: estimate.estimated_amount,
      currency: estimate.currency_to
    }
  });
}

export function normalizeMinimumAmount(api = {}) {
  const minimum = {
    currency_from: toLowerStringOrNull(api.currency_from),
    currency_to: toLowerStringOrNull(api.currency_to),
    min_amount: toNumberOrNull(api.min_amount),
    fiat_equivalent: api.fiat_equivalent == null ? null : toNumberOrNull(api.fiat_equivalent)
  };

  return withAliases(minimum, {
    fromCurrency: minimum.currency_from,
    toCurrency: minimum.currency_to,
    minAmount: minimum.min_amount,
    amount: minimum.min_amount,
    fiatEquivalent: minimum.fiat_equivalent
  });
}

export function normalizeInvoice(api = {}) {
  const invoice = {};
  copyIfPresent(api, invoice, [
    'id',
    'token_id',
    'order_id',
    'order_description',
    'price_amount',
    'price_currency',
    'pay_currency',
    'ipn_callback_url',
    'invoice_url',
    'success_url',
    'cancel_url',
    'partially_paid_url',
    'payout_currency',
    'created_at',
    'updated_at',
    'is_fixed_rate',
    'is_fee_paid_by_user'
  ]);

  if ('id' in invoice) invoice.id = toStringOrNull(invoice.id);
  if ('token_id' in invoice) invoice.token_id = toStringOrNull(invoice.token_id);
  if ('order_id' in invoice) invoice.order_id = toStringOrNull(invoice.order_id);
  if ('order_description' in invoice) invoice.order_description = toStringOrNull(invoice.order_description);
  if ('price_amount' in invoice) invoice.price_amount = toNumberOrNull(invoice.price_amount);
  if ('price_currency' in invoice) invoice.price_currency = toLowerStringOrNull(invoice.price_currency);
  if ('pay_currency' in invoice) invoice.pay_currency = toLowerStringOrNull(invoice.pay_currency);
  if ('ipn_callback_url' in invoice) invoice.ipn_callback_url = toStringOrNull(invoice.ipn_callback_url);
  if ('invoice_url' in invoice) invoice.invoice_url = toStringOrNull(invoice.invoice_url);
  if ('success_url' in invoice) invoice.success_url = toStringOrNull(invoice.success_url);
  if ('cancel_url' in invoice) invoice.cancel_url = toStringOrNull(invoice.cancel_url);
  if ('partially_paid_url' in invoice) invoice.partially_paid_url = toStringOrNull(invoice.partially_paid_url);
  if ('payout_currency' in invoice) invoice.payout_currency = toLowerStringOrNull(invoice.payout_currency);
  if ('created_at' in invoice) invoice.created_at = normalizeDate(invoice.created_at);
  if ('updated_at' in invoice) invoice.updated_at = normalizeDate(invoice.updated_at);
  if ('is_fixed_rate' in invoice) invoice.is_fixed_rate = toBooleanOrNull(invoice.is_fixed_rate);
  if ('is_fee_paid_by_user' in invoice) invoice.is_fee_paid_by_user = toBooleanOrNull(invoice.is_fee_paid_by_user);

  return withAliases(invoice, {
    checkoutUrl: invoice.invoice_url ?? null,
    invoiceUrl: invoice.invoice_url ?? null,
    amount: {
      value: invoice.price_amount ?? null,
      currency: invoice.price_currency ?? null
    },
    paymentCurrency: invoice.pay_currency ?? null,
    order: {
      id: invoice.order_id ?? null,
      description: invoice.order_description ?? null
    },
    redirects: {
      successUrl: invoice.success_url ?? null,
      cancelUrl: invoice.cancel_url ?? null,
      partiallyPaidUrl: invoice.partially_paid_url ?? null
    },
    callbacks: {
      ipnUrl: invoice.ipn_callback_url ?? null
    },
    fixedRate: invoice.is_fixed_rate ?? null,
    feePaidByUser: invoice.is_fee_paid_by_user ?? null,
    createdAt: invoice.created_at ?? null,
    updatedAt: invoice.updated_at ?? null
  });
}

export function normalizePayment(api = {}) {
  const paymentId = toStringOrNull(api.payment_id ?? api.id);
  const invoiceId = toStringOrNull(api.invoice_id);
  const rawStatus = toStringOrNull(api.payment_status ?? api.status);
  const normalizedStatus = normalizePaymentStatus(rawStatus);

  const payment = {
    payment_id: paymentId,
    invoice_id: invoiceId,
    payment_status: rawStatus,
    status: normalizedStatus,
    pay_address: toStringOrNull(api.pay_address),
    payin_extra_id: toStringOrNull(api.payin_extra_id),
    price_amount: toNumberOrNull(api.price_amount),
    price_currency: toLowerStringOrNull(api.price_currency),
    pay_amount: toNumberOrNull(api.pay_amount),
    actually_paid: toNumberOrNull(api.actually_paid),
    actually_paid_at_fiat: toNumberOrNull(api.actually_paid_at_fiat),
    pay_currency: toLowerStringOrNull(api.pay_currency),
    order_id: toStringOrNull(api.order_id),
    order_description: toStringOrNull(api.order_description),
    purchase_id: toStringOrNull(api.purchase_id),
    outcome_amount: toNumberOrNull(api.outcome_amount),
    outcome_currency: toLowerStringOrNull(api.outcome_currency),
    ipn_callback_url: toStringOrNull(api.ipn_callback_url),
    created_at: normalizeDate(api.created_at),
    updated_at: normalizeDate(api.updated_at),
    valid_until: normalizeDate(api.valid_until),
    expiration_estimate_date: normalizeDate(api.expiration_estimate_date),
    amount_received: toNumberOrNull(api.amount_received),
    payin_hash: toStringOrNull(api.payin_hash),
    payout_hash: toStringOrNull(api.payout_hash),
    smart_contract: toStringOrNull(api.smart_contract),
    network: toLowerStringOrNull(api.network),
    network_precision: toNumberOrNull(api.network_precision),
    time_limit: toStringOrNull(api.time_limit),
    burning_percent: toStringOrNull(api.burning_percent),
    type: toStringOrNull(api.type),
    parent_payment_id: toStringOrNull(api.parent_payment_id),
    origin_type: toStringOrNull(api.origin_type),
    payment_extra_ids: Array.isArray(api.payment_extra_ids) ? api.payment_extra_ids.map(toStringOrNull) : null,
    fee: api.fee && typeof api.fee === 'object' ? api.fee : null,
    redirectData: api.redirectData ?? null
  };

  return withAliases(payment, {
    id: payment.payment_id,
    invoiceId: payment.invoice_id,
    rawStatus: payment.payment_status,
    deposit: {
      address: payment.pay_address,
      memo: payment.payin_extra_id,
      network: payment.network,
      precision: payment.network_precision
    },
    price: {
      amount: payment.price_amount,
      currency: payment.price_currency
    },
    payment: {
      amount: payment.pay_amount,
      currency: payment.pay_currency,
      actuallyPaid: payment.actually_paid
    },
    outcome: {
      amount: payment.outcome_amount,
      currency: payment.outcome_currency
    },
    order: {
      id: payment.order_id,
      description: payment.order_description
    },
    purchaseId: payment.purchase_id,
    callbackUrl: payment.ipn_callback_url,
    expiresAt: payment.valid_until ?? payment.expiration_estimate_date,
    createdAt: payment.created_at,
    updatedAt: payment.updated_at
  });
}

export function normalizeCheckoutSession({ invoice, estimate = null, minimum = null } = {}) {
  const checkout = normalizeInvoice(invoice);

  if (estimate !== undefined) checkout.estimate = estimate;
  if (minimum !== undefined) checkout.minimum = minimum;

  return checkout;
}

export function normalizePaymentsList(api = {}) {
  const data = Array.isArray(api.data) ? api.data.map(normalizePayment) : [];
  const list = {
    data,
    limit: toNumberOrNull(api.limit),
    page: toNumberOrNull(api.page),
    pagesCount: toNumberOrNull(api.pagesCount),
    total: toNumberOrNull(api.total)
  };

  return withAliases(list, {
    items: list.data
  });
}

export function normalizeCurrency(api) {
  if (typeof api === 'string') {
    const currency = {
      code: api.toLowerCase(),
      name: null,
      enable: null,
      network: null,
      extra_id_exists: null,
      logo_url: null
    };
    return withAliases(currency, {
      enabled: null,
      requiresExtraId: null,
      logoUrl: null
    });
  }

  const currency = {
    id: api?.id ?? null,
    code: toLowerStringOrNull(api?.code),
    name: toStringOrNull(api?.name),
    enable: api?.enable == null ? null : Boolean(api.enable),
    network: toLowerStringOrNull(api?.network),
    extra_id_exists: api?.extra_id_exists == null ? null : Boolean(api.extra_id_exists),
    logo_url: toStringOrNull(api?.logo_url),
    track: api?.track ?? null,
    cg_id: toStringOrNull(api?.cg_id),
    is_maxlimit: api?.is_maxlimit ?? null,
    smart_contract: toStringOrNull(api?.smart_contract),
    network_precision: toNumberOrNull(api?.network_precision)
  };

  return withAliases(currency, {
    enabled: currency.enable,
    requiresExtraId: currency.extra_id_exists,
    logoUrl: currency.logo_url
  });
}

export function normalizeCurrencies(api) {
  const list = Array.isArray(api?.currencies) ? api.currencies : Array.isArray(api) ? api : [];
  return list.map(normalizeCurrency).filter((currency) => currency.code);
}
