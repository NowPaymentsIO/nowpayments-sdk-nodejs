export type SDKErrorType = 'configuration' | 'validation' | 'network' | 'timeout' | 'api' | 'unknown';

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'paid'
  | 'partially_paid'
  | 'failed'
  | 'refunded'
  | 'expired'
  | 'cancelled'
  | 'unknown';

export type PayoutStatus =
  | 'pending'
  | 'processing'
  | 'sending'
  | 'finished'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'unknown';

/** SDK-side policy used only for balance preflight; it is not sent to NOWPayments. */
export type PayoutNetworkFeePolicy = 'sender' | 'recipient';

export interface SDKErrorJSON {
  name: string;
  type: SDKErrorType;
  code: string;
  message: string;
  httpStatus?: number;
  requestId?: string;
  details?: unknown;
}

export class SDKError extends Error {
  name: 'SDKError' | string;
  type: SDKErrorType;
  code: string;
  httpStatus?: number;
  requestId?: string;
  details?: unknown;
  constructor(options?: {
    type?: SDKErrorType;
    code?: string;
    message?: string;
    httpStatus?: number;
    requestId?: string;
    details?: unknown;
    cause?: unknown;
  });
  toJSON(): SDKErrorJSON;
}

export class ConfigurationError extends SDKError {}
export class ValidationError extends SDKError {}
export class NetworkError extends SDKError {}
export class APIError extends SDKError {}
export function isSDKError(error: unknown): error is SDKError;
export function toSDKError(error: unknown): SDKError;

export interface NowPaymentsSDKOptions {
  apiKey?: string;
  ipnSecret?: string;
  jwtToken?: string;
  token?: string;
  /** Dashboard email. When paired with password, JWT is obtained and refreshed automatically for Bearer-protected endpoints. */
  email?: string;
  /** Dashboard password. When paired with email, JWT is cached in memory and refreshed automatically. */
  password?: string;
  /** Refresh JWT this many milliseconds before exp. Default: 30000. */
  jwtRefreshSkewMs?: number;
  /** Refresh JWT this many seconds before exp. Used only when jwtRefreshSkewMs is not set. */
  jwtRefreshSkewSeconds?: number;
  /** Fallback in-memory TTL for auth responses whose JWT cannot be decoded. Default: 240000. */
  jwtFallbackTtlMs?: number;
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
  fetch?: typeof fetch;
  ipnCallbackUrl?: string;
  successUrl?: string;
  cancelUrl?: string;
  partiallyPaidUrl?: string;

  /** Base32 TOTP secret from NOWPayments account 2FA settings. Enables automatic payout verification. */
  twoFactorSecret?: string;
  /** Alias for twoFactorSecret. */
  twoFaSecret?: string;
  /** Alias for twoFactorSecret. */
  totpSecret?: string;
  /** Snake-case alias for twoFactorSecret. */
  two_fa_secret?: string;
  /** Compatibility alias for twoFactorSecret. */
  '2faSecret'?: string;
  /** Custom async 2FA code source, useful for secret managers or external OTP services. */
  twoFactorCodeProvider?: (context: PayoutVerificationCodeContext) => string | number | Promise<string | number>;
  /** Alias for twoFactorCodeProvider. */
  payoutVerificationCodeProvider?: (context: PayoutVerificationCodeContext) => string | number | Promise<string | number>;
  /** Automatically verify a newly created payout when a code source is available. Default: true. */
  autoVerifyPayouts?: boolean;
  /** Alias for autoVerifyPayouts. */
  autoVerifyPayout?: boolean;
  /** Injectable clock for deterministic TOTP generation. Returns Unix time in milliseconds. */
  totpNow?: () => number;
  totpAlgorithm?: 'sha1' | 'sha256' | 'sha512';
  /** NOWPayments verification codes contain exactly six digits. */
  totpDigits?: 6;
  totpPeriod?: number;
  /** Default IPN callback URL for payouts. */
  payoutIpnCallbackUrl?: string;
  /** Default description for payouts. */
  payoutDescription?: string;
  /** Conservative balance policy used by payout preflight. Default: sender. */
  networkFeePaidBy?: PayoutNetworkFeePolicy | 'receiver';
  /** Maximum concurrent preflight requests. Default: 5; maximum: 25. */
  payoutPreflightConcurrency?: number;
}

export interface CheckoutInput {
  amount?: number;
  priceAmount?: number;
  price_amount?: number;
  currency?: string;
  priceCurrency?: string;
  price_currency?: string;
  payCurrency?: string;
  pay_currency?: string;
  payoutCurrency?: string;
  payout_currency?: string;
  orderId?: string;
  order_id?: string;
  description?: string;
  orderDescription?: string;
  order_description?: string;
  ipnCallbackUrl?: string;
  ipn_callback_url?: string;
  successUrl?: string;
  success_url?: string;
  cancelUrl?: string;
  cancel_url?: string;
  partiallyPaidUrl?: string;
  partially_paid_url?: string;
  fixedRate?: boolean;
  feePaidByUser?: boolean;
  isFixedRate?: boolean;
  isFeePaidByUser?: boolean;
  skipPreflight?: boolean;
}

export interface DirectPaymentInput extends CheckoutInput {
  payCurrency: string;
  payAmount?: number;
  pay_amount?: number;
  payoutAddress?: string;
  payout_address?: string;
  payoutExtraId?: string | null;
  payout_extra_id?: string | null;
  originIp?: string;
}

export interface EstimateInput {
  amount: number;
  fromCurrency?: string;
  currencyFrom?: string;
  currency_from?: string;
  toCurrency?: string;
  currencyTo?: string;
  currency_to?: string;
}

export interface MinimumAmountInput {
  fromCurrency?: string;
  currencyFrom?: string;
  currency_from?: string;
  toCurrency?: string;
  currencyTo?: string;
  currency_to?: string;
  fiatEquivalent?: number;
  fixedRate?: boolean;
  feePaidByUser?: boolean;
  isFixedRate?: boolean;
  isFeePaidByUser?: boolean;
}

export interface InvoicePaymentInput {
  invoiceId?: string;
  iid?: string;
  payCurrency?: string;
  pay_currency?: string;
  purchaseId?: string;
  purchase_id?: string;
  description?: string;
  orderDescription?: string;
  order_description?: string;
  customerEmail?: string;
  customer_email?: string;
  payoutAddress?: string;
  payout_address?: string;
  payoutExtraId?: string | null;
  payout_extra_id?: string | null;
  payoutCurrency?: string;
  payout_currency?: string;
  originIp?: string;
}

export interface Estimate {
  currency_from: string | null;
  amount_from: number | null;
  currency_to: string | null;
  estimated_amount: number | null;
  fromCurrency: string | null;
  amountFrom: number | null;
  toCurrency: string | null;
  estimatedAmount: number | null;
  from: { amount: number | null; currency: string | null };
  to: { amount: number | null; currency: string | null };
}

export interface MinimumAmount {
  currency_from: string | null;
  currency_to: string | null;
  min_amount: number | null;
  fiat_equivalent: number | null;
  fromCurrency: string | null;
  toCurrency: string | null;
  minAmount: number | null;
  amount: number | null;
  fiatEquivalent: number | null;
}

export interface Invoice {
  id: string | null;
  token_id?: string | null;
  order_id?: string | null;
  order_description?: string | null;
  price_amount?: number | null;
  price_currency?: string | null;
  pay_currency?: string | null;
  ipn_callback_url?: string | null;
  invoice_url?: string | null;
  success_url?: string | null;
  cancel_url?: string | null;
  partially_paid_url?: string | null;
  payout_currency?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_fixed_rate?: boolean | null;
  is_fee_paid_by_user?: boolean | null;

  /** Convenience aliases. They are non-enumerable at runtime, so JSON output remains close to the API body. */
  checkoutUrl: string | null;
  invoiceUrl: string | null;
  amount: { value: number | null; currency: string | null };
  paymentCurrency: string | null;
  order: { id: string | null; description: string | null };
  redirects: { successUrl: string | null; cancelUrl: string | null; partiallyPaidUrl: string | null };
  callbacks: { ipnUrl: string | null };
  fixedRate: boolean | null;
  feePaidByUser: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Payment {
  payment_id: string | null;
  invoice_id: string | null;
  payment_status: string | null;
  status: PaymentStatus;
  pay_address: string | null;
  payin_extra_id: string | null;
  price_amount: number | null;
  price_currency: string | null;
  pay_amount: number | null;
  actually_paid: number | null;
  actually_paid_at_fiat: number | null;
  pay_currency: string | null;
  order_id: string | null;
  order_description: string | null;
  purchase_id: string | null;
  outcome_amount: number | null;
  outcome_currency: string | null;
  ipn_callback_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  valid_until: string | null;
  expiration_estimate_date: string | null;
  amount_received: number | null;
  payin_hash: string | null;
  payout_hash: string | null;
  smart_contract: string | null;
  network: string | null;
  network_precision: number | null;
  time_limit: string | null;
  burning_percent: string | null;
  type: string | null;
  parent_payment_id: string | null;
  origin_type: string | null;
  payment_extra_ids: Array<string | null> | null;
  fee: unknown | null;
  redirectData: unknown | null;

  /** Convenience aliases. They are non-enumerable at runtime. */
  id: string | null;
  invoiceId: string | null;
  rawStatus: string | null;
  deposit: { address: string | null; memo: string | null; network: string | null; precision: number | null };
  price: { amount: number | null; currency: string | null };
  payment: { amount: number | null; currency: string | null; actuallyPaid: number | null };
  outcome: { amount: number | null; currency: string | null };
  order: { id: string | null; description: string | null };
  purchaseId: string | null;
  callbackUrl: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  estimate?: Estimate | null;
  minimum?: MinimumAmount | null;
}

export interface CheckoutSession extends Invoice {
  estimate: Estimate | null;
  minimum: MinimumAmount | null;
}

export interface PaymentsListQuery {
  limit?: number;
  page?: number;
  sortBy?: string;
  sort_by?: string;
  orderBy?: 'asc' | 'desc' | string;
  order_by?: 'asc' | 'desc' | string;
  dateFrom?: string;
  date_from?: string;
  dateTo?: string;
  date_to?: string;
  invoiceId?: string | number;
  invoice_id?: string | number;
}

export interface PaymentsList {
  data: Payment[];
  items: Payment[];
  page: number | null;
  limit: number | null;
  total: number | null;
  pagesCount: number | null;
}

export interface Currency {
  id?: string | number | null;
  code: string;
  name: string | null;
  enable: boolean | null;
  network: string | null;
  extra_id_exists: boolean | null;
  logo_url: string | null;
  track?: boolean | null;
  cg_id?: string | null;
  is_maxlimit?: boolean | null;
  smart_contract?: string | null;
  network_precision?: number | null;
  enabled: boolean | null;
  requiresExtraId: boolean | null;
  logoUrl: string | null;
}


export interface PayoutWithdrawalInput {
  address: string;
  currency: string;
  /** Crypto amount. NOWPayments allows at most six decimal places. */
  amount: number;
  extraId?: string | null;
  extra_id?: string | null;
  ipnCallbackUrl?: string;
  ipn_callback_url?: string;
  payoutDescription?: string;
  payout_description?: string;
  uniqueExternalId?: string;
  unique_external_id?: string;
  /** Fiat amount that overrides amount for payout calculation on the API side. */
  fiatAmount?: number;
  fiat_amount?: number;
  fiatCurrency?: string;
  fiat_currency?: string;
}

export interface PayoutCreateControls {
  /** Advanced escape hatch. Default: false. */
  skipPreflight?: boolean;
  skip_preflight?: boolean;
  /** Override constructor-level automatic verification for this call. */
  autoVerify?: boolean;
  auto_verify?: boolean;
  /** Six-digit code for immediate verification without configuring a secret. */
  verificationCode?: string | number;
  verification_code?: string | number;
  /** SDK-side balance validation policy; not sent to NOWPayments. */
  networkFeePaidBy?: PayoutNetworkFeePolicy | 'receiver';
  network_fee_paid_by?: PayoutNetworkFeePolicy | 'receiver';
  preflightConcurrency?: number;
  preflight_concurrency?: number;
}

export interface SinglePayoutInput extends PayoutWithdrawalInput, PayoutCreateControls {
  /** Batch-level callback URL for a single-withdrawal batch. */
  batchIpnCallbackUrl?: string;
  batch_ipn_callback_url?: string;
  /** Batch-level description for a single-withdrawal batch. */
  batchPayoutDescription?: string;
  batch_payout_description?: string;
}

export interface PayoutBatchInput extends PayoutCreateControls {
  withdrawals: PayoutWithdrawalInput[];
  /** Batch-level callback URL. Individual withdrawal callbacks still take precedence. */
  ipnCallbackUrl?: string;
  ipn_callback_url?: string;
  payoutDescription?: string;
  payout_description?: string;
}

export type CreatePayoutInput = SinglePayoutInput | PayoutBatchInput | PayoutWithdrawalInput[];

export interface PayoutVerificationCodeContext {
  batchId: string;
  secret: string | null;
  sdk: NowPaymentsSDK;
}

export interface TotpOptions {
  algorithm?: 'sha1' | 'sha256' | 'sha512';
  digits?: number;
  period?: number;
  /** Unix time in milliseconds. Default: Date.now(). */
  timestamp?: number;
}

export interface PayoutBalanceEntry {
  amount: number | null;
  pendingAmount: number | null;
  /** Non-enumerable convenience aliases. */
  currency: string;
  available: number | null;
  pending: number | null;
}

export type PayoutBalance = Record<string, PayoutBalanceEntry>;

export interface PayoutAddressInput {
  address: string;
  currency: string;
  extraId?: string | null;
  extra_id?: string | null;
}

export interface PayoutAddressValidation {
  valid: true;
  address: string | null;
  currency: string | null;
  extra_id: string | null;
  extraId: string | null;
  [key: string]: unknown;
}

export interface PayoutFeeInput {
  currency: string;
  amount: number;
}

export interface PayoutFeeEstimate {
  currency: string | null;
  amount: number | null;
  fee: number | null;
  estimatedFee: number | null;
}

export interface MinimumPayoutAmount {
  success: boolean;
  currency: string | null;
  result: number | null;
  amount: number | null;
  minAmount: number | null;
}

export interface Payout {
  id: string | null;
  batch_withdrawal_id: string | null;
  payout_status: string | null;
  status: PayoutStatus;
  error: unknown | null;
  currency: string | null;
  amount: number | null;
  address: string | null;
  fee: number | Record<string, unknown> | null;
  extra_id: string | null;
  hash: string | null;
  ipn_callback_url: string | null;
  payout_description: string | null;
  unique_external_id: string | null;
  fiat_amount: number | null;
  fiat_currency: string | null;
  is_request_payouts: boolean | null;
  created_at: string | null;
  requested_at: string | null;
  updated_at: string | null;

  /** Non-enumerable convenience aliases. */
  payoutId: string | null;
  batchId: string | null;
  rawStatus: string | null;
  extraId: string | null;
  callbackUrl: string | null;
  description: string | null;
  uniqueExternalId: string | null;
  fiatAmount: number | null;
  fiatCurrency: string | null;
  createdAt: string | null;
  requestedAt: string | null;
  updatedAt: string | null;
}

export interface PayoutPreflightWithdrawal {
  index: number;
  address: string;
  currency: string;
  requestedAmount: number;
  effectiveAmount: number;
  fiatEstimate: Estimate | null;
  minimum: MinimumPayoutAmount;
  fee: PayoutFeeEstimate;
}

export interface PayoutPreflightCurrencyTotal {
  currency: string;
  available: number;
  pending: number;
  requestedAmount: number;
  estimatedFee: number;
  requiredAmount: number;
  coversAmount: boolean;
  coversAmountAndFee: boolean;
}

export interface PayoutPreflight {
  skipped: boolean;
  networkFeePaidBy: PayoutNetworkFeePolicy;
  balance: PayoutBalance | null;
  withdrawals: PayoutPreflightWithdrawal[];
  totals: Record<string, PayoutPreflightCurrencyTotal>;
}

export interface PayoutVerification {
  verified: boolean;
  batch_withdrawal_id: string | null;
  batchId: string | null;
  [key: string]: unknown;
}

export interface PayoutBatch {
  id: string | null;
  withdrawals: Payout[];
  ipn_callback_url: string | null;
  payout_description: string | null;
  preflight: PayoutPreflight | null;
  verified: boolean;
  requires_verification: boolean;
  verification: PayoutVerification | null;

  /** Non-enumerable convenience aliases. */
  batchId: string | null;
  items: Payout[];
  callbackUrl: string | null;
  description: string | null;
  requiresVerification: boolean;
}

/** A batch returned by createPayout(); creation throws when the API omits its id. */
export interface CreatedPayoutBatch extends PayoutBatch {
  id: string;
  batchId: string;
}

export interface PayoutsListQuery {
  batchId?: string | number;
  batch_id?: string | number;
  status?: 'creating' | 'waiting' | 'processing' | 'finished' | 'failed' | 'rejected';
  orderBy?: 'id' | 'batchId' | 'dateCreated' | 'dateRequested' | 'dateUpdated' | 'currency' | 'status';
  order_by?: 'id' | 'batchId' | 'dateCreated' | 'dateRequested' | 'dateUpdated' | 'currency' | 'status';
  order?: 'asc' | 'desc';
  dateFrom?: string;
  date_from?: string;
  dateTo?: string;
  date_to?: string;
  limit?: number;
  page?: number;
}

export interface PayoutsList {
  payouts: Payout[];
  data: Payout[];
  items: Payout[];
  page: number | null;
  limit: number | null;
  total: number | null;
  pagesCount: number | null;
}

export interface WatchPayoutStatusOptions {
  intervalMs?: number;
  timeoutMs?: number;
  terminalStatuses?: PayoutStatus[];
}

export class PayoutStatusWatcher {
  start(): this;
  stop(): this;
  on(event: 'status', listener: (payout: Payout) => void): this;
  on(event: 'change', listener: (event: { from: PayoutStatus; to: PayoutStatus; payout: Payout }) => void): this;
  on(event: 'terminal', listener: (payout: Payout) => void): this;
  on(event: 'timeout', listener: (event: { payoutId: string }) => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
}

export interface WatchPaymentStatusOptions {
  intervalMs?: number;
  timeoutMs?: number;
  terminalStatuses?: PaymentStatus[];
}

export class PaymentStatusWatcher {
  start(): this;
  stop(): this;
  on(event: 'status', listener: (payment: Payment) => void): this;
  on(event: 'change', listener: (event: { from: PaymentStatus; to: PaymentStatus; payment: Payment }) => void): this;
  on(event: 'terminal', listener: (payment: Payment) => void): this;
  on(event: 'timeout', listener: (event: { paymentId: string }) => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
}

export interface RawClient {
  getApiStatus(): Promise<unknown>;
  authenticate(credentials: { email: string; password: string }): Promise<{ token?: string }>;
  getEstimatedPrice(query: Record<string, unknown>): Promise<unknown>;
  getMinimumPaymentAmount(query: Record<string, unknown>): Promise<unknown>;
  getCurrencies(query?: Record<string, unknown>): Promise<unknown>;
  getFullCurrencies(): Promise<unknown>;
  getMerchantCoins(): Promise<unknown>;
  getBalance(): Promise<unknown>;
  validatePayoutAddress(body: Record<string, unknown>): Promise<unknown>;
  verifyPayout(batchId: string, body: { verification_code: string }): Promise<unknown>;
  getPayoutStatus(payoutId: string): Promise<unknown>;
  getPayoutFee(query: Record<string, unknown>): Promise<unknown>;
  createPayout(body: Record<string, unknown>): Promise<unknown>;
  listPayouts(query?: Record<string, unknown>): Promise<unknown>;
  getMinimumPayoutAmount(currency: string): Promise<unknown>;
  createInvoice(body: Record<string, unknown>): Promise<unknown>;
  createPayment(body: Record<string, unknown>, options?: { originIp?: string }): Promise<unknown>;
  createPaymentByInvoice(body: Record<string, unknown>, options?: { originIp?: string }): Promise<unknown>;
  updatePaymentEstimate(paymentId: string): Promise<unknown>;
  getPaymentStatus(paymentId: string): Promise<unknown>;
  listPayments(query?: Record<string, unknown>): Promise<unknown>;
}

export class NowPaymentsSDK {
  raw: RawClient;
  jwtToken: string | null;
  jwtExpiresAt: number | null;
  constructor(options?: NowPaymentsSDKOptions);
  setJwtToken(token: string | null): this;
  isJwtTokenExpired(now?: number): boolean;
  hasAuthCredentials(): boolean;
  getJwtToken(options?: { forceRefresh?: boolean }): Promise<string | null>;
  refreshJwtToken(): Promise<string | null>;
  getApiStatus(): Promise<unknown>;
  authenticate(credentials?: { email?: string; password?: string }): Promise<string | null>;
  estimatePrice(input: EstimateInput): Promise<Estimate>;
  getMinimumPaymentAmount(input: MinimumAmountInput): Promise<MinimumAmount>;
  getAvailableCurrencies(options?: { onlyEnabled?: boolean }): Promise<Currency[]>;
  /** Returns currencies available for fixed-rate payments (GET /v1/currencies?fixed_rate=true). */
  getFixedRateCurrencies(): Promise<Currency[]>;
  /** Returns currencies enabled for this merchant account (GET /v1/merchant/coins). */
  getMerchantCurrencies(): Promise<Currency[]>;
  createInvoice(input: CheckoutInput): Promise<Invoice>;
  createPaymentFromInvoice(input: InvoicePaymentInput): Promise<Payment>;
  createDirectPayment(input: DirectPaymentInput): Promise<Payment>;
  createPayment(input: CheckoutInput): Promise<CheckoutSession>;
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  createHostedCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  refreshPaymentEstimate(paymentId: string): Promise<Payment>;
  getPaymentStatus(paymentId: string): Promise<Payment>;
  listPayments(query?: PaymentsListQuery): Promise<PaymentsList>;
  /** Returns the custody balance used by Mass payouts. */
  getBalance(): Promise<PayoutBalance>;
  /** Alias for getBalance(). */
  getPayoutBalance(): Promise<PayoutBalance>;
  validatePayoutAddress(input: PayoutAddressInput): Promise<PayoutAddressValidation>;
  getPayoutFeeEstimate(input: PayoutFeeInput): Promise<PayoutFeeEstimate>;
  getMinimumPayoutAmount(input: string | { currency?: string; coin?: string }): Promise<MinimumPayoutAmount>;
  preflightPayout(input: CreatePayoutInput): Promise<PayoutPreflight>;
  /** Creates a single payout or batch and automatically verifies it when a 2FA code source is configured. */
  createPayout(input: CreatePayoutInput): Promise<CreatedPayoutBatch>;
  verifyPayout(batchId: string | number, verificationCode: string | number): Promise<PayoutVerification>;
  getPayoutStatus(payoutId: string | number): Promise<Payout>;
  listPayouts(query?: PayoutsListQuery): Promise<PayoutsList>;
  watchPayoutStatus(payoutId: string | number, options?: WatchPayoutStatusOptions): PayoutStatusWatcher;
  onPayoutStatusChange(
    payoutId: string | number,
    callback: (event: { from: PayoutStatus | null; to: PayoutStatus; payout: Payout }) => void,
    options?: WatchPayoutStatusOptions
  ): () => void;
  watchPaymentStatus(paymentId: string, options?: WatchPaymentStatusOptions): PaymentStatusWatcher;
  onPaymentStatusChange(
    paymentId: string,
    callback: (event: { from: PaymentStatus | null; to: PaymentStatus; payment: Payment }) => void,
    options?: WatchPaymentStatusOptions
  ): () => void;
  verifyWebhookSignature(payload: Record<string, unknown>, signature: string, secret?: string): boolean;
  parseWebhook(payload: Record<string, unknown>, signature?: string, options?: { secret?: string; verify?: boolean }):
    | { type: 'payment.status_changed'; payment: Payment }
    | { type: 'payout.status_changed'; payout: Payout }
    | { type: 'unknown'; data: null };
}

export function normalizePaymentStatus(apiStatus: string): PaymentStatus;
export function normalizePayment(api: Record<string, unknown>): Payment;
export function normalizeInvoice(api: Record<string, unknown>): Invoice;
export function normalizeEstimate(api: Record<string, unknown>): Estimate;
export function normalizeMinimumAmount(api: Record<string, unknown>): MinimumAmount;
export function normalizeCurrencies(api: unknown): Currency[];
export function normalizePayoutStatus(apiStatus: string): PayoutStatus;
export function normalizePayout(api: Record<string, unknown>): Payout;
export function normalizePayoutBatch(
  api: Record<string, unknown>,
  options?: { preflight?: PayoutPreflight | null; verified?: boolean; requiresVerification?: boolean; verification?: PayoutVerification | null }
): PayoutBatch;
export function normalizePayoutsList(api: unknown): PayoutsList;
export function normalizeBalance(api: unknown): PayoutBalance;
export function normalizePayoutAddressValidation(api: unknown, input?: PayoutAddressInput): PayoutAddressValidation;
export function normalizePayoutFee(api: Record<string, unknown>, input?: Partial<PayoutFeeInput>): PayoutFeeEstimate;
export function normalizeMinimumPayoutAmount(api: Record<string, unknown>, currency?: string): MinimumPayoutAmount;
export function generateTotpCode(secret: string, options?: TotpOptions): string;

export const SDK_PAYMENT_STATUSES: Readonly<{
  PENDING: 'pending';
  PROCESSING: 'processing';
  PAID: 'paid';
  PARTIALLY_PAID: 'partially_paid';
  FAILED: 'failed';
  REFUNDED: 'refunded';
  EXPIRED: 'expired';
  CANCELLED: 'cancelled';
  UNKNOWN: 'unknown';
}>;
export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[];

export const SDK_PAYOUT_STATUSES: Readonly<{
  PENDING: 'pending';
  PROCESSING: 'processing';
  SENDING: 'sending';
  FINISHED: 'finished';
  FAILED: 'failed';
  REJECTED: 'rejected';
  CANCELLED: 'cancelled';
  UNKNOWN: 'unknown';
}>;
export const TERMINAL_PAYOUT_STATUSES: readonly PayoutStatus[];

export function sortObjectDeep<T>(value: T): T;
export function createWebhookSignature(payload: Record<string, unknown>, secret: string): string;
export function verifyWebhookSignature(payload: Record<string, unknown>, signature: string, secret: string): boolean;
export function normalizeWebhook(payload: Record<string, unknown>):
  | { type: 'payment.status_changed'; payment: Payment }
  | { type: 'payout.status_changed'; payout: Payout }
  | { type: 'unknown'; data: null };

export default NowPaymentsSDK;
