import { HttpClient } from './http.js';
import { APIError, ValidationError } from './errors.js';
import {
  normalizeCheckoutSession,
  normalizeCurrencies,
  normalizeEstimate,
  normalizeInvoice,
  normalizeMinimumAmount,
  normalizePayment,
  normalizePaymentsList
} from './normalizers.js';
import { normalizeWebhook, verifyWebhookSignature as verifyIpnSignature } from './ipn.js';
import { PaymentStatusWatcher } from './watcher.js';
import {
  compactObject,
  validateCheckoutInput,
  validateDirectPaymentInput,
  validateEstimateInput,
  validateInvoicePaymentInput,
  validateMinimumInput,
  validatePaymentId,
  validatePaymentsListQuery
} from './validators.js';


const DEFAULT_JWT_REFRESH_SKEW_MS = 30_000;
const DEFAULT_JWT_FALLBACK_TTL_MS = 4 * 60 * 1000;

function base64UrlDecode(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function getJwtExpiresAtMs(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [, payload] = token.split('.');
  if (!payload) return null;

  try {
    const decoded = JSON.parse(base64UrlDecode(payload));
    if (typeof decoded.exp !== 'number' || !Number.isFinite(decoded.exp)) return null;
    return decoded.exp * 1000;
  } catch {
    return null;
  }
}

function normalizeRefreshSkewMs(options = {}) {
  const value = options.jwtRefreshSkewMs ?? (
    options.jwtRefreshSkewSeconds == null ? undefined : Number(options.jwtRefreshSkewSeconds) * 1000
  );
  if (value == null) return DEFAULT_JWT_REFRESH_SKEW_MS;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : DEFAULT_JWT_REFRESH_SKEW_MS;
}

function toApiBoolean(value) {
  if (value === undefined || value === null) return undefined;
  return Boolean(value);
}

function checkoutToInvoicePayload(input) {
  return compactObject({
    price_amount: input.amount,
    price_currency: input.currency,
    pay_currency: input.payCurrency ?? input.pay_currency,
    order_id: input.orderId ?? input.order_id,
    order_description: input.description ?? input.orderDescription ?? input.order_description,
    ipn_callback_url: input.ipnCallbackUrl ?? input.ipn_callback_url,
    success_url: input.successUrl ?? input.success_url,
    cancel_url: input.cancelUrl ?? input.cancel_url,
    partially_paid_url: input.partiallyPaidUrl ?? input.partially_paid_url,
    is_fixed_rate: toApiBoolean(input.fixedRate ?? input.isFixedRate),
    is_fee_paid_by_user: toApiBoolean(input.feePaidByUser ?? input.isFeePaidByUser)
  });
}

function directPaymentPayload(input) {
  return compactObject({
    price_amount: input.amount,
    price_currency: input.currency,
    pay_amount: input.payAmount ?? input.pay_amount,
    pay_currency: input.payCurrency ?? input.pay_currency,
    ipn_callback_url: input.ipnCallbackUrl ?? input.ipn_callback_url,
    order_id: input.orderId ?? input.order_id,
    order_description: input.description ?? input.orderDescription ?? input.order_description,
    payout_address: input.payoutAddress ?? input.payout_address,
    payout_currency: input.payoutCurrency ?? input.payout_currency,
    payout_extra_id: input.payoutExtraId ?? input.payout_extra_id,
    is_fixed_rate: toApiBoolean(input.fixedRate ?? input.isFixedRate),
    is_fee_paid_by_user: toApiBoolean(input.feePaidByUser ?? input.isFeePaidByUser)
  });
}

function invoicePaymentPayload(input) {
  return compactObject({
    iid: input.invoiceId,
    pay_currency: input.payCurrency ?? input.pay_currency,
    purchase_id: input.purchaseId ?? input.purchase_id,
    order_description: input.description ?? input.orderDescription ?? input.order_description,
    customer_email: input.customerEmail ?? input.customer_email,
    payout_address: input.payoutAddress ?? input.payout_address,
    payout_extra_id: input.payoutExtraId ?? input.payout_extra_id,
    payout_currency: input.payoutCurrency ?? input.payout_currency
  });
}

export class NowPaymentsSDK {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.ipnSecret = options.ipnSecret;
    this.jwtToken = null;
    this.jwtExpiresAt = null;
    this.jwtRefreshSkewMs = normalizeRefreshSkewMs(options);
    this.jwtFallbackTtlMs = Number.isFinite(Number(options.jwtFallbackTtlMs)) && Number(options.jwtFallbackTtlMs) > 0
      ? Number(options.jwtFallbackTtlMs)
      : DEFAULT_JWT_FALLBACK_TTL_MS;
    this.authPromise = null;
    this.email = options.email;
    this.password = options.password;
    this.defaultIpnCallbackUrl = options.ipnCallbackUrl;
    this.defaultSuccessUrl = options.successUrl;
    this.defaultCancelUrl = options.cancelUrl;
    this.defaultPartiallyPaidUrl = options.partiallyPaidUrl;

    this.setJwtToken(options.jwtToken ?? options.token ?? null);

    this.http = new HttpClient({
      apiKey: this.apiKey,
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetch,
      userAgent: options.userAgent,
      getJwtToken: (jwtOptions) => this.getJwtToken(jwtOptions)
    });

    this.raw = this.createRawClient();
  }

  createRawClient() {
    return {
      getApiStatus: () => this.http.request('/v1/status', { apiKey: false }),
      authenticate: (credentials) => this.http.request('/v1/auth', {
        method: 'POST',
        apiKey: false,
        body: credentials
      }),
      getEstimatedPrice: (query) => this.http.request('/v1/estimate', { query }),
      getMinimumPaymentAmount: (query) => this.http.request('/v1/min-amount', { query }),
      getCurrencies: (query) => this.http.request('/v1/currencies', { query }),
      getFullCurrencies: () => this.http.request('/v1/full-currencies'),
      getMerchantCoins: () => this.http.request('/v1/merchant/coins'),
      getBalance: () => this.http.request('/v1/balance'),
      createInvoice: (body) => this.http.request('/v1/invoice', { method: 'POST', body }),
      createPayment: (body, options = {}) => this.http.request('/v1/payment', {
        method: 'POST',
        body,
        headers: compactObject({ 'origin-ip': options.originIp })
      }),
      createPaymentByInvoice: (body, options = {}) => this.http.request('/v1/invoice-payment', {
        method: 'POST',
        body,
        headers: compactObject({ 'origin-ip': options.originIp })
      }),
      updatePaymentEstimate: (paymentId) => this.http.request(`/v1/payment/${encodeURIComponent(paymentId)}/update-merchant-estimate`, {
        method: 'POST'
      }),
      getPaymentStatus: (paymentId) => this.http.request(`/v1/payment/${encodeURIComponent(paymentId)}`),
      listPayments: (query) => this.http.request('/v1/payment/', { query, bearer: true })
    };
  }

  setJwtToken(token) {
    this.jwtToken = token || null;
    this.jwtExpiresAt = getJwtExpiresAtMs(this.jwtToken);
    return this;
  }

  isJwtTokenExpired(now = Date.now()) {
    if (!this.jwtToken) return true;
    if (!this.jwtExpiresAt) return false;
    return this.jwtExpiresAt <= now + this.jwtRefreshSkewMs;
  }

  hasAuthCredentials() {
    return Boolean(this.email && this.password);
  }

  async getJwtToken(options = {}) {
    const forceRefresh = Boolean(options.forceRefresh);

    if (!forceRefresh && this.jwtToken && !this.isJwtTokenExpired()) {
      return this.jwtToken;
    }

    if (!this.hasAuthCredentials()) {
      return this.jwtToken;
    }

    return this.refreshJwtToken();
  }

  async refreshJwtToken() {
    if (!this.hasAuthCredentials()) {
      throw new ValidationError('email and password are required for automatic JWT authentication.', {
        code: 'MISSING_AUTH_CREDENTIALS'
      });
    }

    if (this.authPromise) return this.authPromise;

    this.authPromise = (async () => {
      const response = await this.raw.authenticate({ email: this.email, password: this.password });
      const token = response?.token;
      if (typeof token !== 'string' || token.length === 0) {
        throw new APIError('Authentication response did not include a JWT token.', {
          code: 'INVALID_AUTH_RESPONSE',
          details: response
        });
      }

      this.setJwtToken(token);
      if (!this.jwtExpiresAt) {
        this.jwtExpiresAt = Date.now() + this.jwtFallbackTtlMs;
      }
      return this.jwtToken;
    })();

    try {
      return await this.authPromise;
    } finally {
      this.authPromise = null;
    }
  }

  async getApiStatus() {
    return this.raw.getApiStatus();
  }

  async authenticate(credentials = {}) {
    const email = credentials.email ?? this.email;
    const password = credentials.password ?? this.password;
    if (!email || !password) {
      throw new ValidationError('email and password are required for authentication.', {
        code: 'MISSING_AUTH_CREDENTIALS'
      });
    }

    this.email = email;
    this.password = password;
    return this.refreshJwtToken();
  }

  async estimatePrice(input) {
    const normalized = validateEstimateInput(input);
    const response = await this.raw.getEstimatedPrice({
      amount: normalized.amount,
      currency_from: normalized.fromCurrency,
      currency_to: normalized.toCurrency
    });
    return normalizeEstimate(response);
  }

  async getMinimumPaymentAmount(input) {
    const normalized = validateMinimumInput(input);
    const response = await this.raw.getMinimumPaymentAmount(compactObject({
      currency_from: normalized.fromCurrency,
      currency_to: normalized.toCurrency,
      fiat_equivalent: normalized.fiatEquivalent,
      is_fixed_rate: normalized.fixedRate ?? normalized.isFixedRate,
      is_fee_paid_by_user: normalized.feePaidByUser ?? normalized.isFeePaidByUser
    }));
    return normalizeMinimumAmount(response);
  }

  async getAvailableCurrencies(options = {}) {
    const response = await this.raw.getFullCurrencies();
    const currencies = normalizeCurrencies(response);
    if (options.onlyEnabled === false) return currencies;
    // Explicit check for true: currency.enabled can be null for string-only entries.
    return currencies.filter((c) => c.enabled === true || c.enable === true);
  }

  /**
   * Returns currencies available for fixed-rate payments.
   * Backed by GET /v1/currencies?fixed_rate=true.
   * For the full enriched list, use getAvailableCurrencies().
   */
  async getFixedRateCurrencies() {
    const response = await this.raw.getCurrencies({ fixed_rate: true });
    return normalizeCurrencies(response);
  }

  /**
   * Returns only the currencies enabled for this specific merchant account.
   * Backed by GET /v1/merchant/coins.
   */
  async getMerchantCurrencies() {
    const response = await this.raw.getMerchantCoins();
    return normalizeCurrencies(response);
  }

  async createInvoice(input) {
    const normalized = validateCheckoutInput(this.applyDefaults(input));
    const response = await this.raw.createInvoice(checkoutToInvoicePayload(normalized));
    return normalizeInvoice(response);
  }

  async createPaymentFromInvoice(input) {
    const normalized = validateInvoicePaymentInput(input);
    const response = await this.raw.createPaymentByInvoice(invoicePaymentPayload(normalized), {
      originIp: input.originIp
    });
    return normalizePayment(response);
  }

  async createDirectPayment(input) {
    const normalized = validateDirectPaymentInput(this.applyDefaults(input));
    const { estimate, minimum } = await this.preflightPayment(normalized);
    const response = await this.raw.createPayment(directPaymentPayload(normalized), {
      originIp: normalized.originIp
    });
    const payment = normalizePayment(response);
    payment.estimate = estimate;
    payment.minimum = minimum;
    return payment;
  }

  async createPayment(input) {
    return this.createCheckout(input);
  }

  async createCheckout(input) {
    const normalized = validateCheckoutInput(this.applyDefaults(input));
    const { estimate, minimum } = await this.preflightPayment(normalized);
    const invoice = await this.raw.createInvoice(checkoutToInvoicePayload(normalized));
    return normalizeCheckoutSession({ invoice, estimate, minimum });
  }

  async createHostedCheckout(input) {
    return this.createCheckout(input);
  }

  async refreshPaymentEstimate(paymentId) {
    const id = validatePaymentId(paymentId);
    const response = await this.raw.updatePaymentEstimate(id);
    // Normalize as a payment object for a consistent public contract.
    // The API response is payment-shaped; we ensure payment_id is always set.
    return normalizePayment({ payment_id: id, ...response });
  }

  async getPaymentStatus(paymentId) {
    const id = validatePaymentId(paymentId);
    const response = await this.raw.getPaymentStatus(id);
    return normalizePayment(response);
  }

  async listPayments(query = {}) {
    const response = await this.raw.listPayments(validatePaymentsListQuery(query));
    return normalizePaymentsList(response);
  }

  watchPaymentStatus(paymentId, options = {}) {
    const id = validatePaymentId(paymentId);
    return new PaymentStatusWatcher({ sdk: this, paymentId: id, ...options }).start();
  }

  onPaymentStatusChange(paymentId, callback, options = {}) {
    if (typeof callback !== 'function') {
      throw new ValidationError('callback must be a function.', { code: 'INVALID_CALLBACK' });
    }
    const watcher = this.watchPaymentStatus(paymentId, options);

    // 'change' covers every transition that has a known previous status.
    watcher.on('change', callback);

    // 'terminal' is used only when the payment was already in a terminal status
    // on the very first poll (lastStatus was null, so 'change' was never emitted).
    // When 'change' fires in the same poll cycle as 'terminal' (status transition
    // reached a terminal status), _changeEverFired is already true, so we skip
    // the callback here to avoid double-invoking it.
    watcher.on('terminal', (payment) => {
      if (!watcher._changeEverFired) {
        callback({ from: null, to: payment.status, payment });
      }
    });

    return () => watcher.stop();
  }

  verifyWebhookSignature(payload, signature, secret = this.ipnSecret) {
    return verifyIpnSignature(payload, signature, secret);
  }

  parseWebhook(payload, signature, options = {}) {
    const secret = options.secret ?? this.ipnSecret;
    if (options.verify !== false) {
      const valid = this.verifyWebhookSignature(payload, signature, secret);
      if (!valid) {
        throw new ValidationError('Invalid NOWPayments webhook signature.', {
          code: 'INVALID_WEBHOOK_SIGNATURE'
        });
      }
    }
    return normalizeWebhook(payload);
  }

  applyDefaults(input = {}) {
    return {
      ...input,
      ipnCallbackUrl: input.ipnCallbackUrl ?? input.ipn_callback_url ?? this.defaultIpnCallbackUrl,
      successUrl: input.successUrl ?? input.success_url ?? this.defaultSuccessUrl,
      cancelUrl: input.cancelUrl ?? input.cancel_url ?? this.defaultCancelUrl,
      partiallyPaidUrl: input.partiallyPaidUrl ?? input.partially_paid_url ?? this.defaultPartiallyPaidUrl
    };
  }

  async preflightPayment(input) {
    if (input.skipPreflight || !input.payCurrency) {
      return { estimate: null, minimum: null };
    }

    const estimate = await this.estimatePrice({
      amount: input.amount,
      fromCurrency: input.currency,
      toCurrency: input.payCurrency
    });

    // fiatEquivalent is a numeric value, not a currency code — do not pass input.currency here.
    const minimum = await this.getMinimumPaymentAmount({
      fromCurrency: input.payCurrency,
      toCurrency: input.payoutCurrency,
      fixedRate: input.fixedRate ?? input.isFixedRate,
      feePaidByUser: input.feePaidByUser ?? input.isFeePaidByUser
    });

    if (
      typeof estimate.estimated_amount === 'number' &&
      typeof minimum.min_amount === 'number' &&
      estimate.estimated_amount < minimum.min_amount
    ) {
      throw new ValidationError('Payment amount is below the minimum amount for the selected currency pair.', {
        code: 'BELOW_MINIMUM_PAYMENT_AMOUNT',
        details: {
          estimatedPayAmount: estimate.estimated_amount,
          minimumPayAmount: minimum.min_amount,
          payCurrency: input.payCurrency,
          priceAmount: input.amount,
          priceCurrency: input.currency
        }
      });
    }

    return { estimate, minimum };
  }
}
