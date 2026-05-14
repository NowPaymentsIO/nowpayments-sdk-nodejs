import { HttpClient } from './http.js';
import { ValidationError } from './errors.js';
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
  validatePaymentId
} from './validators.js';

function toApiBoolean(value) {
  if (value === undefined || value === null) return undefined;
  return Boolean(value);
}

function checkoutToInvoicePayload(input) {
  return compactObject({
    price_amount: input.amount,
    price_currency: input.currency,
    pay_currency: input.payCurrency,
    order_id: input.orderId,
    order_description: input.description ?? input.orderDescription,
    ipn_callback_url: input.ipnCallbackUrl,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    partially_paid_url: input.partiallyPaidUrl,
    is_fixed_rate: toApiBoolean(input.fixedRate ?? input.isFixedRate),
    is_fee_paid_by_user: toApiBoolean(input.feePaidByUser ?? input.isFeePaidByUser)
  });
}

function directPaymentPayload(input) {
  return compactObject({
    price_amount: input.amount,
    price_currency: input.currency,
    pay_amount: input.payAmount,
    pay_currency: input.payCurrency,
    ipn_callback_url: input.ipnCallbackUrl,
    order_id: input.orderId,
    order_description: input.description ?? input.orderDescription,
    payout_address: input.payoutAddress,
    payout_currency: input.payoutCurrency,
    payout_extra_id: input.payoutExtraId,
    is_fixed_rate: toApiBoolean(input.fixedRate ?? input.isFixedRate),
    is_fee_paid_by_user: toApiBoolean(input.feePaidByUser ?? input.isFeePaidByUser)
  });
}

function invoicePaymentPayload(input) {
  return compactObject({
    iid: input.invoiceId,
    pay_currency: input.payCurrency,
    purchase_id: input.purchaseId,
    order_description: input.description ?? input.orderDescription,
    customer_email: input.customerEmail,
    payout_address: input.payoutAddress,
    payout_extra_id: input.payoutExtraId,
    payout_currency: input.payoutCurrency
  });
}

export class NowPaymentsSDK {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.ipnSecret = options.ipnSecret;
    this.jwtToken = options.jwtToken ?? options.token ?? null;
    this.email = options.email;
    this.password = options.password;
    this.defaultIpnCallbackUrl = options.ipnCallbackUrl;
    this.defaultSuccessUrl = options.successUrl;
    this.defaultCancelUrl = options.cancelUrl;
    this.defaultPartiallyPaidUrl = options.partiallyPaidUrl;

    this.http = new HttpClient({
      apiKey: this.apiKey,
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetch,
      userAgent: options.userAgent,
      getJwtToken: () => this.jwtToken,
      autoAuthenticate: this.email && this.password ? () => this.authenticate() : undefined
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
      getFullCurrencies: () => this.http.request('/v1/full-currencies'),
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
    return this;
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

    const response = await this.raw.authenticate({ email, password });
    this.jwtToken = response?.token ?? null;
    return this.jwtToken;
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
    return currencies.filter((currency) => currency.enabled !== false);
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
    return {
      paymentId: String(response?.id ?? id),
      amount: response?.pay_amount == null ? null : Number(response.pay_amount),
      expiresAt: response?.expiration_estimate_date ? new Date(response.expiration_estimate_date).toISOString() : null
    };
  }

  async getPaymentStatus(paymentId) {
    const id = validatePaymentId(paymentId);
    const response = await this.raw.getPaymentStatus(id);
    return normalizePayment(response);
  }

  async listPayments(query = {}) {
    const response = await this.raw.listPayments(compactObject({
      limit: query.limit,
      page: query.page,
      sortBy: query.sortBy,
      orderBy: query.orderBy,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      invoiceId: query.invoiceId
    }));
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
    watcher.on('change', callback);
    watcher.on('terminal', (payment) => callback({ from: watcher.lastStatus, to: payment.status, payment }));
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

  applyDefaults(input) {
    return {
      ...input,
      ipnCallbackUrl: input.ipnCallbackUrl ?? this.defaultIpnCallbackUrl,
      successUrl: input.successUrl ?? this.defaultSuccessUrl,
      cancelUrl: input.cancelUrl ?? this.defaultCancelUrl,
      partiallyPaidUrl: input.partiallyPaidUrl ?? this.defaultPartiallyPaidUrl
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

    const minimum = await this.getMinimumPaymentAmount({
      fromCurrency: input.payCurrency,
      toCurrency: input.payoutCurrency,
      fiatEquivalent: input.currency,
      fixedRate: input.fixedRate ?? input.isFixedRate,
      feePaidByUser: input.feePaidByUser ?? input.isFeePaidByUser
    });

    if (
      typeof estimate.amount === 'number' &&
      typeof minimum.amount === 'number' &&
      estimate.amount < minimum.amount
    ) {
      throw new ValidationError('Payment amount is below the minimum amount for the selected currency pair.', {
        code: 'BELOW_MINIMUM_PAYMENT_AMOUNT',
        details: {
          estimatedPayAmount: estimate.amount,
          minimumPayAmount: minimum.amount,
          payCurrency: input.payCurrency,
          priceAmount: input.amount,
          priceCurrency: input.currency
        }
      });
    }

    return { estimate, minimum };
  }
}
