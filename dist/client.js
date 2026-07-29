import { HttpClient } from './http.js';
import { APIError, ConfigurationError, ValidationError } from './errors.js';
import {
  normalizeBalance,
  normalizeCheckoutSession,
  normalizeCurrencies,
  normalizeEstimate,
  normalizeInvoice,
  normalizeMinimumAmount,
  normalizeMinimumPayoutAmount,
  normalizePayment,
  normalizePaymentsList,
  normalizePayout,
  normalizePayoutAddressValidation,
  normalizePayoutBatch,
  normalizePayoutFee,
  normalizePayoutsList,
  normalizePayoutVerification
} from './normalizers.js';
import { normalizeWebhook, verifyWebhookSignature as verifyIpnSignature } from './ipn.js';
import { PaymentStatusWatcher } from './watcher.js';
import { PayoutStatusWatcher } from './payout-watcher.js';
import { generateTotpCode } from './totp.js';
import {
  compactObject,
  validateCheckoutInput,
  validateDirectPaymentInput,
  validateEstimateInput,
  validateInvoicePaymentInput,
  validateMinimumInput,
  validateMinimumPayoutCurrency,
  validateNetworkFeePaidBy,
  validatePaymentId,
  validatePaymentsListQuery,
  validatePayoutAddressInput,
  validatePayoutBatchId,
  validatePayoutCreateInput,
  validatePayoutFeeInput,
  validatePayoutId,
  validatePayoutsListQuery,
  validatePayoutVerificationCode
} from './validators.js';

const DEFAULT_JWT_REFRESH_SKEW_MS = 30_000;
const DEFAULT_JWT_FALLBACK_TTL_MS = 4 * 60 * 1000;
const DEFAULT_PAYOUT_PREFLIGHT_CONCURRENCY = 5;
const BALANCE_COMPARISON_EPSILON = 1e-12;

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

function normalizeConcurrency(value, fallback = DEFAULT_PAYOUT_PREFLIGHT_CONCURRENCY) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return Math.min(numeric, 25);
}

function normalizeConfigurationBoolean(value, fallback, fieldName) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  throw new ConfigurationError(`${fieldName} must be a boolean.`, {
    code: 'INVALID_PAYOUT_CONFIGURATION',
    details: { field: fieldName, value }
  });
}

function normalizePayoutPreflightConcurrency(value) {
  if (value == null) return DEFAULT_PAYOUT_PREFLIGHT_CONCURRENCY;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 25) {
    throw new ConfigurationError('payoutPreflightConcurrency must be an integer between 1 and 25.', {
      code: 'INVALID_PAYOUT_CONFIGURATION',
      details: { field: 'payoutPreflightConcurrency', value }
    });
  }
  return numeric;
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

function payoutWithdrawalPayload(withdrawal) {
  return compactObject({
    address: withdrawal.address,
    currency: withdrawal.currency,
    amount: withdrawal.amount,
    extra_id: withdrawal.extraId,
    ipn_callback_url: withdrawal.ipnCallbackUrl,
    payout_description: withdrawal.payoutDescription,
    unique_external_id: withdrawal.uniqueExternalId,
    fiat_amount: withdrawal.fiatAmount,
    fiat_currency: withdrawal.fiatCurrency
  });
}

function payoutPayload(input) {
  return compactObject({
    ipn_callback_url: input.ipnCallbackUrl,
    withdrawals: input.withdrawals.map((withdrawal) => payoutWithdrawalPayload({
      ...withdrawal,
      payoutDescription: withdrawal.payoutDescription ?? input.payoutDescription
    }))
  });
}

function payoutListQuery(query) {
  return compactObject({
    batch_id: query.batchId,
    status: query.status,
    order_by: query.orderBy,
    order: query.order,
    date_from: query.dateFrom,
    date_to: query.dateTo,
    limit: query.limit,
    page: query.page
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

function addAmount(left, right) {
  return Number((Number(left || 0) + Number(right || 0)).toPrecision(15));
}

function attachPayoutVerificationError(error, batchId) {
  const verificationError = typeof error?.toJSON === 'function'
    ? error.toJSON()
    : { name: error?.name, code: error?.code, message: error?.message };

  return new APIError(`Payout batch ${batchId} was created, but automatic 2FA verification failed: ${error?.message || 'unknown verification error'}`, {
    code: 'PAYOUT_VERIFICATION_FAILED',
    httpStatus: error?.httpStatus,
    requestId: error?.requestId,
    details: {
      batchId,
      verificationError,
      api: error instanceof APIError ? error.details : undefined
    },
    cause: error
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

    this.twoFactorSecret = options.twoFactorSecret
      ?? options.twoFaSecret
      ?? options.totpSecret
      ?? options.two_fa_secret
      ?? options['2faSecret']
      ?? null;
    this.twoFactorCodeProvider = options.twoFactorCodeProvider ?? options.payoutVerificationCodeProvider ?? null;
    this.autoVerifyPayouts = normalizeConfigurationBoolean(
      options.autoVerifyPayouts ?? options.autoVerifyPayout,
      true,
      'autoVerifyPayouts'
    );
    this.totpNow = options.totpNow ?? Date.now;
    this.totpOptions = compactObject({
      algorithm: options.totpAlgorithm,
      digits: options.totpDigits,
      period: options.totpPeriod
    });
    this.defaultPayoutIpnCallbackUrl = options.payoutIpnCallbackUrl ?? options.ipnCallbackUrl;
    this.defaultPayoutDescription = options.payoutDescription;
    this.networkFeePaidBy = validateNetworkFeePaidBy(options.networkFeePaidBy ?? 'sender');
    this.payoutPreflightConcurrency = normalizePayoutPreflightConcurrency(options.payoutPreflightConcurrency);

    if (this.twoFactorCodeProvider != null && typeof this.twoFactorCodeProvider !== 'function') {
      throw new ConfigurationError('twoFactorCodeProvider must be a function.', {
        code: 'INVALID_2FA_CODE_PROVIDER'
      });
    }
    if (typeof this.totpNow !== 'function') {
      throw new ConfigurationError('totpNow must be a function returning milliseconds.', {
        code: 'INVALID_TOTP_CLOCK'
      });
    }
    if (options.totpDigits != null && Number(options.totpDigits) !== 6) {
      throw new ConfigurationError('totpDigits must be 6 for NOWPayments payout verification.', {
        code: 'INVALID_PAYOUT_TOTP_DIGITS',
        details: { field: 'totpDigits', value: options.totpDigits }
      });
    }
    if (this.twoFactorSecret) {
      try {
        generateTotpCode(this.twoFactorSecret, { ...this.totpOptions, timestamp: 0 });
      } catch (error) {
        const invalidTotpConfiguration = error?.code === 'INVALID_TOTP_CONFIGURATION';
        throw new ConfigurationError(
          invalidTotpConfiguration
            ? 'The payout TOTP configuration is invalid.'
            : 'twoFactorSecret must be a valid Base32 TOTP secret or otpauth URI.',
          {
            code: invalidTotpConfiguration ? 'INVALID_TOTP_CONFIGURATION' : 'INVALID_2FA_SECRET',
            details: error?.details,
            cause: error
          }
        );
      }
    }

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
      validatePayoutAddress: (body) => this.http.request('/v1/payout/validate-address', {
        method: 'POST',
        body
      }),
      verifyPayout: (batchId, body) => this.http.request(`/v1/payout/${encodeURIComponent(batchId)}/verify`, {
        method: 'POST',
        body,
        bearer: true
      }),
      getPayoutStatus: (payoutId) => this.http.request(`/v1/payout/${encodeURIComponent(payoutId)}`),
      getPayoutFee: (query) => this.http.request('/v1/payout/fee', { query }),
      createPayout: (body) => this.http.request('/v1/payout', {
        method: 'POST',
        body,
        bearer: true
      }),
      listPayouts: (query) => this.http.request('/v1/payout', { query }),
      getMinimumPayoutAmount: (currency) => this.http.request(`/v1/payout-withdrawal/min-amount/${encodeURIComponent(currency)}`),
      createInvoice: (body) => this.http.request('/v1/invoice', { method: 'POST', body }),
      createPayment: (body, requestOptions = {}) => this.http.request('/v1/payment', {
        method: 'POST',
        body,
        headers: compactObject({ 'origin-ip': requestOptions.originIp })
      }),
      createPaymentByInvoice: (body, requestOptions = {}) => this.http.request('/v1/invoice-payment', {
        method: 'POST',
        body,
        headers: compactObject({ 'origin-ip': requestOptions.originIp })
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
    return currencies.filter((currency) => currency.enabled === true || currency.enable === true);
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
    watcher.on('change', callback);
    watcher.on('terminal', (payment) => {
      if (!watcher._changeEverFired) {
        callback({ from: null, to: payment.status, payment });
      }
    });
    return () => watcher.stop();
  }

  /** Returns the custody balance used by Mass payouts. */
  async getBalance() {
    return normalizeBalance(await this.raw.getBalance());
  }

  async getPayoutBalance() {
    return this.getBalance();
  }

  async validatePayoutAddress(input) {
    const normalized = validatePayoutAddressInput(input);
    try {
      const response = await this.raw.validatePayoutAddress(compactObject({
        address: normalized.address,
        currency: normalized.currency,
        extra_id: normalized.extraId
      }));
      return normalizePayoutAddressValidation(response, normalized);
    } catch (error) {
      if (error instanceof APIError && error.httpStatus === 400) {
        throw new ValidationError('The payout address is not valid for the selected currency.', {
          code: 'INVALID_PAYOUT_ADDRESS',
          details: {
            address: normalized.address,
            currency: normalized.currency,
            extraId: normalized.extraId,
            api: error.details
          },
          cause: error
        });
      }
      throw error;
    }
  }

  async getPayoutFeeEstimate(input) {
    const normalized = validatePayoutFeeInput(input);
    const response = await this.raw.getPayoutFee({
      currency: normalized.currency,
      amount: normalized.amount
    });
    return normalizePayoutFee(response, normalized);
  }

  async getMinimumPayoutAmount(input) {
    const currency = validateMinimumPayoutCurrency(input);
    const response = await this.raw.getMinimumPayoutAmount(currency);
    return normalizeMinimumPayoutAmount(response, currency);
  }

  async preflightPayout(input) {
    const normalized = validatePayoutCreateInput(this.applyPayoutDefaults(input));
    if (normalized.skipPreflight) return this.skippedPayoutPreflight(normalized);
    return this.performPayoutPreflight(normalized);
  }

  async createPayout(input) {
    const normalized = validatePayoutCreateInput(this.applyPayoutDefaults(input));
    this.assertPayoutAuthenticationConfigured();
    const preflight = normalized.skipPreflight
      ? this.skippedPayoutPreflight(normalized)
      : await this.performPayoutPreflight(normalized);

    const response = await this.raw.createPayout(payoutPayload(normalized));
    const batchId = String(response?.id ?? response?.batch_withdrawal_id ?? '').trim();
    if (!batchId) {
      throw new APIError('Create payout response did not include a batch id.', {
        code: 'INVALID_PAYOUT_RESPONSE',
        details: response
      });
    }

    const batchResponse = {
      ipn_callback_url: normalized.ipnCallbackUrl,
      payout_description: normalized.payoutDescription,
      ...(response && typeof response === 'object' && !Array.isArray(response) ? response : {})
    };

    try {
      const autoVerify = normalized.autoVerify ?? this.autoVerifyPayouts;
      const verificationCode = autoVerify
        ? await this.getPayoutVerificationCode({
            batchId,
            verificationCode: normalized.verificationCode
          })
        : null;

      if (!verificationCode) {
        return normalizePayoutBatch(batchResponse, {
          preflight,
          verified: false,
          requiresVerification: true
        });
      }

      const verification = await this.verifyPayout(batchId, verificationCode);
      return normalizePayoutBatch(batchResponse, {
        preflight,
        verified: true,
        requiresVerification: false,
        verification
      });
    } catch (error) {
      throw attachPayoutVerificationError(error, batchId);
    }
  }

  async verifyPayout(batchId, verificationCode) {
    this.assertPayoutAuthenticationConfigured();
    const id = validatePayoutBatchId(batchId);
    const code = validatePayoutVerificationCode(verificationCode);
    const response = await this.raw.verifyPayout(id, { verification_code: code });
    return normalizePayoutVerification(response, id);
  }

  async getPayoutStatus(payoutId) {
    const id = validatePayoutId(payoutId);
    const response = await this.raw.getPayoutStatus(id);
    const withdrawals = Array.isArray(response)
      ? response
      : Array.isArray(response?.withdrawals)
        ? response.withdrawals
        : Array.isArray(response?.payouts)
          ? response.payouts
          : null;
    const rawPayout = withdrawals
      ? withdrawals.find((item) => String(item?.id ?? item?.payout_id) === String(id)) ?? withdrawals[0]
      : response;
    return normalizePayout({ ...(rawPayout || {}), id: rawPayout?.id ?? rawPayout?.payout_id ?? id });
  }

  async listPayouts(query = {}) {
    const normalized = validatePayoutsListQuery(query);
    const response = await this.raw.listPayouts(payoutListQuery(normalized));
    return normalizePayoutsList(response);
  }

  watchPayoutStatus(payoutId, options = {}) {
    const id = validatePayoutId(payoutId);
    return new PayoutStatusWatcher({ sdk: this, payoutId: id, ...options }).start();
  }

  onPayoutStatusChange(payoutId, callback, options = {}) {
    if (typeof callback !== 'function') {
      throw new ValidationError('callback must be a function.', { code: 'INVALID_CALLBACK' });
    }
    const watcher = this.watchPayoutStatus(payoutId, options);
    watcher.on('change', callback);
    watcher.on('terminal', (payout) => {
      if (!watcher._changeEverFired) {
        callback({ from: null, to: payout.status, payout });
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

  applyPayoutDefaults(input = {}) {
    if (Array.isArray(input)) {
      return compactObject({
        withdrawals: input,
        ipnCallbackUrl: this.defaultPayoutIpnCallbackUrl,
        payoutDescription: this.defaultPayoutDescription
      });
    }

    return {
      ...input,
      ipnCallbackUrl: input.ipnCallbackUrl ?? input.ipn_callback_url ?? this.defaultPayoutIpnCallbackUrl,
      payoutDescription: input.payoutDescription ?? input.payout_description ?? this.defaultPayoutDescription
    };
  }

  assertPayoutAuthenticationConfigured() {
    if (!this.jwtToken && !this.hasAuthCredentials()) {
      throw new ConfigurationError(
        'Mass payout creation and verification require either { email, password } for automatic JWT authentication or { jwtToken }.',
        { code: 'MISSING_PAYOUT_AUTHENTICATION' }
      );
    }

    if (this.jwtToken && this.jwtExpiresAt && this.isJwtTokenExpired() && !this.hasAuthCredentials()) {
      throw new ConfigurationError(
        'The configured JWT token is expired. Pass { email, password } for automatic refresh or provide a fresh jwtToken.',
        { code: 'EXPIRED_PAYOUT_JWT' }
      );
    }
  }

  async getPayoutVerificationCode({ batchId, verificationCode } = {}) {
    if (verificationCode != null && verificationCode !== '') {
      return validatePayoutVerificationCode(verificationCode);
    }

    if (this.twoFactorCodeProvider) {
      const provided = await this.twoFactorCodeProvider({
        batchId,
        secret: this.twoFactorSecret,
        sdk: this
      });
      return validatePayoutVerificationCode(provided);
    }

    if (!this.twoFactorSecret) return null;
    const timestamp = Number(this.totpNow());
    return validatePayoutVerificationCode(generateTotpCode(this.twoFactorSecret, {
      ...this.totpOptions,
      timestamp
    }));
  }

  skippedPayoutPreflight(input) {
    return {
      skipped: true,
      networkFeePaidBy: validateNetworkFeePaidBy(input.networkFeePaidBy ?? this.networkFeePaidBy),
      balance: null,
      withdrawals: [],
      totals: {}
    };
  }

  async performPayoutPreflight(input) {
    const concurrency = normalizeConcurrency(input.preflightConcurrency, this.payoutPreflightConcurrency);
    const networkFeePaidBy = validateNetworkFeePaidBy(input.networkFeePaidBy ?? this.networkFeePaidBy);

    const balancePromise = this.getBalance();
    const resolvedWithdrawalsPromise = mapWithConcurrency(input.withdrawals, concurrency, async (withdrawal, index) => {
      let effectiveAmount = withdrawal.amount;
      let fiatEstimate = null;

      if (withdrawal.fiatAmount != null) {
        fiatEstimate = await this.estimatePrice({
          amount: withdrawal.fiatAmount,
          fromCurrency: withdrawal.fiatCurrency,
          toCurrency: withdrawal.currency
        });
        if (typeof fiatEstimate.estimated_amount !== 'number' || fiatEstimate.estimated_amount <= 0) {
          throw new APIError('Fiat payout estimate did not include a positive crypto amount.', {
            code: 'INVALID_PAYOUT_FIAT_ESTIMATE',
            details: { index, currency: withdrawal.currency, response: fiatEstimate }
          });
        }
        effectiveAmount = fiatEstimate.estimated_amount;
      }

      return { index, withdrawal, effectiveAmount, fiatEstimate };
    });

    const [balance, resolvedWithdrawals] = await Promise.all([
      balancePromise,
      resolvedWithdrawalsPromise
    ]);

    const currencies = [...new Set(resolvedWithdrawals.map((item) => item.withdrawal.currency))];
    const minimumEntries = await mapWithConcurrency(currencies, concurrency, async (currency) => [
      currency,
      await this.getMinimumPayoutAmount(currency)
    ]);
    const minimumByCurrency = new Map(minimumEntries);

    for (const item of resolvedWithdrawals) {
      const minimum = minimumByCurrency.get(item.withdrawal.currency);
      if (!minimum?.success || typeof minimum.result !== 'number') {
        throw new APIError('Minimum payout amount is unavailable for the selected currency.', {
          code: 'PAYOUT_MINIMUM_UNAVAILABLE',
          details: { index: item.index, currency: item.withdrawal.currency, response: minimum }
        });
      }

      if (item.effectiveAmount + BALANCE_COMPARISON_EPSILON < minimum.result) {
        throw new ValidationError('Payout amount is below the minimum amount for the selected currency.', {
          code: 'BELOW_MINIMUM_PAYOUT_AMOUNT',
          details: {
            index: item.index,
            currency: item.withdrawal.currency,
            payoutAmount: item.effectiveAmount,
            minimumPayoutAmount: minimum.result,
            address: item.withdrawal.address
          }
        });
      }
    }

    const feeEstimates = await mapWithConcurrency(resolvedWithdrawals, concurrency, async (item) => {
      const fee = await this.getPayoutFeeEstimate({
        currency: item.withdrawal.currency,
        amount: item.effectiveAmount
      });
      if (typeof fee.fee !== 'number' || fee.fee < 0) {
        throw new APIError('Payout fee estimate did not include a valid fee.', {
          code: 'INVALID_PAYOUT_FEE_ESTIMATE',
          details: { index: item.index, currency: item.withdrawal.currency, response: fee }
        });
      }
      return fee;
    });

    const checkedWithdrawals = resolvedWithdrawals.map((item, index) => ({
      index: item.index,
      address: item.withdrawal.address,
      currency: item.withdrawal.currency,
      requestedAmount: item.withdrawal.amount,
      effectiveAmount: item.effectiveAmount,
      fiatEstimate: item.fiatEstimate,
      minimum: minimumByCurrency.get(item.withdrawal.currency),
      fee: feeEstimates[index]
    }));

    const totals = {};
    for (const item of checkedWithdrawals) {
      const currency = item.currency;
      const existing = totals[currency] ?? {
        currency,
        available: balance[currency]?.amount ?? 0,
        pending: balance[currency]?.pendingAmount ?? 0,
        requestedAmount: 0,
        estimatedFee: 0,
        requiredAmount: 0,
        coversAmount: false,
        coversAmountAndFee: false
      };
      existing.requestedAmount = addAmount(existing.requestedAmount, item.effectiveAmount);
      existing.estimatedFee = addAmount(existing.estimatedFee, item.fee.fee);
      totals[currency] = existing;
    }

    for (const total of Object.values(totals)) {
      total.coversAmount = total.available + BALANCE_COMPARISON_EPSILON >= total.requestedAmount;
      total.coversAmountAndFee = total.available + BALANCE_COMPARISON_EPSILON >= addAmount(total.requestedAmount, total.estimatedFee);
      total.requiredAmount = networkFeePaidBy === 'sender'
        ? addAmount(total.requestedAmount, total.estimatedFee)
        : total.requestedAmount;

      if (total.available + BALANCE_COMPARISON_EPSILON < total.requiredAmount) {
        const feeIsOnlyShortfall = total.coversAmount && networkFeePaidBy === 'sender';
        throw new ValidationError(
          feeIsOnlyShortfall
            ? `Insufficient ${total.currency} balance to cover payouts and estimated network fees.`
            : `Insufficient ${total.currency} balance for the requested payouts.`,
          {
            code: feeIsOnlyShortfall
              ? 'INSUFFICIENT_PAYOUT_BALANCE_WITH_FEE'
              : 'INSUFFICIENT_PAYOUT_BALANCE',
            details: {
              currency: total.currency,
              available: total.available,
              requestedAmount: total.requestedAmount,
              estimatedFee: total.estimatedFee,
              requiredAmount: total.requiredAmount,
              networkFeePaidBy
            }
          }
        );
      }
    }

    return {
      skipped: false,
      networkFeePaidBy,
      balance,
      withdrawals: checkedWithdrawals,
      totals
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
