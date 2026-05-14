export const SDK_PAYMENT_STATUSES = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  PAID: 'paid',
  PARTIALLY_PAID: 'partially_paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  EXPIRED: 'expired',
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
  expired: SDK_PAYMENT_STATUSES.EXPIRED
});

export const TERMINAL_PAYMENT_STATUSES = Object.freeze([
  SDK_PAYMENT_STATUSES.PAID,
  SDK_PAYMENT_STATUSES.PARTIALLY_PAID,
  SDK_PAYMENT_STATUSES.FAILED,
  SDK_PAYMENT_STATUSES.REFUNDED,
  SDK_PAYMENT_STATUSES.EXPIRED
]);

export function normalizePaymentStatus(apiStatus) {
  if (!apiStatus || typeof apiStatus !== 'string') return SDK_PAYMENT_STATUSES.UNKNOWN;
  return PAYMENT_STATUS_MAP[apiStatus.toLowerCase()] || SDK_PAYMENT_STATUSES.UNKNOWN;
}

function toStringOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeEstimate(api = {}) {
  return {
    amount: toNumberOrNull(api.estimated_amount),
    from: {
      amount: toNumberOrNull(api.amount_from),
      currency: toStringOrNull(api.currency_from)?.toLowerCase() ?? null
    },
    to: {
      currency: toStringOrNull(api.currency_to)?.toLowerCase() ?? null
    }
  };
}

export function normalizeMinimumAmount(api = {}) {
  return {
    amount: toNumberOrNull(api.min_amount),
    fromCurrency: toStringOrNull(api.currency_from)?.toLowerCase() ?? null,
    toCurrency: toStringOrNull(api.currency_to)?.toLowerCase() ?? null,
    fiatEquivalent: api.fiat_equivalent == null ? null : toNumberOrNull(api.fiat_equivalent)
  };
}

export function normalizeInvoice(api = {}) {
  return {
    id: toStringOrNull(api.id),
    checkoutUrl: toStringOrNull(api.invoice_url),
    amount: {
      value: toNumberOrNull(api.price_amount),
      currency: toStringOrNull(api.price_currency)?.toLowerCase() ?? null
    },
    paymentCurrency: toStringOrNull(api.pay_currency)?.toLowerCase() ?? null,
    order: {
      id: toStringOrNull(api.order_id),
      description: toStringOrNull(api.order_description)
    },
    redirects: {
      successUrl: toStringOrNull(api.success_url),
      cancelUrl: toStringOrNull(api.cancel_url),
      partiallyPaidUrl: toStringOrNull(api.partially_paid_url)
    },
    callbacks: {
      ipnUrl: toStringOrNull(api.ipn_callback_url)
    },
    fixedRate: api.is_fixed_rate == null ? null : Boolean(api.is_fixed_rate),
    feePaidByUser: api.is_fee_paid_by_user == null ? null : Boolean(api.is_fee_paid_by_user),
    createdAt: normalizeDate(api.created_at),
    updatedAt: normalizeDate(api.updated_at)
  };
}

export function normalizePayment(api = {}) {
  return {
    id: toStringOrNull(api.payment_id ?? api.id),
    invoiceId: toStringOrNull(api.invoice_id),
    status: normalizePaymentStatus(api.payment_status ?? api.status),
    deposit: {
      address: toStringOrNull(api.pay_address),
      memo: toStringOrNull(api.payin_extra_id),
      network: toStringOrNull(api.network)?.toLowerCase() ?? null,
      precision: api.network_precision == null ? null : toNumberOrNull(api.network_precision)
    },
    price: {
      amount: toNumberOrNull(api.price_amount),
      currency: toStringOrNull(api.price_currency)?.toLowerCase() ?? null
    },
    payment: {
      amount: toNumberOrNull(api.pay_amount),
      currency: toStringOrNull(api.pay_currency)?.toLowerCase() ?? null,
      actuallyPaid: toNumberOrNull(api.actually_paid)
    },
    outcome: {
      amount: toNumberOrNull(api.outcome_amount),
      currency: toStringOrNull(api.outcome_currency)?.toLowerCase() ?? null
    },
    order: {
      id: toStringOrNull(api.order_id),
      description: toStringOrNull(api.order_description)
    },
    purchaseId: toStringOrNull(api.purchase_id),
    callbackUrl: toStringOrNull(api.ipn_callback_url),
    expiresAt: normalizeDate(api.valid_until ?? api.expiration_estimate_date),
    createdAt: normalizeDate(api.created_at),
    updatedAt: normalizeDate(api.updated_at)
  };
}

export function normalizeCheckoutSession({ invoice, estimate = null, minimum = null, payment = null } = {}) {
  const normalizedInvoice = normalizeInvoice(invoice);
  return {
    id: normalizedInvoice.id,
    checkoutUrl: normalizedInvoice.checkoutUrl,
    status: SDK_PAYMENT_STATUSES.PENDING,
    invoice: normalizedInvoice,
    payment,
    estimate,
    minimum,
    createdAt: normalizedInvoice.createdAt,
    updatedAt: normalizedInvoice.updatedAt
  };
}

export function normalizePaymentsList(api = {}) {
  const data = Array.isArray(api.data) ? api.data : [];
  return {
    items: data.map(normalizePayment),
    page: toNumberOrNull(api.page),
    limit: toNumberOrNull(api.limit),
    total: toNumberOrNull(api.total),
    pagesCount: toNumberOrNull(api.pagesCount)
  };
}

export function normalizeCurrency(api) {
  if (typeof api === 'string') {
    return {
      code: api.toLowerCase(),
      name: null,
      enabled: null,
      network: null,
      requiresExtraId: null,
      logoUrl: null
    };
  }

  return {
    code: toStringOrNull(api?.code)?.toLowerCase() ?? null,
    name: toStringOrNull(api?.name),
    enabled: api?.enable == null ? null : Boolean(api.enable),
    network: toStringOrNull(api?.network)?.toLowerCase() ?? null,
    requiresExtraId: api?.extra_id_exists == null ? null : Boolean(api.extra_id_exists),
    logoUrl: toStringOrNull(api?.logo_url)
  };
}

export function normalizeCurrencies(api) {
  const list = Array.isArray(api?.currencies) ? api.currencies : Array.isArray(api) ? api : [];
  return list.map(normalizeCurrency).filter((currency) => currency.code);
}
