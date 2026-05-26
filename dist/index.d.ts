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
  watchPaymentStatus(paymentId: string, options?: WatchPaymentStatusOptions): PaymentStatusWatcher;
  onPaymentStatusChange(
    paymentId: string,
    callback: (event: { from: PaymentStatus | null; to: PaymentStatus; payment: Payment }) => void,
    options?: WatchPaymentStatusOptions
  ): () => void;
  verifyWebhookSignature(payload: Record<string, unknown>, signature: string, secret?: string): boolean;
  parseWebhook(payload: Record<string, unknown>, signature?: string, options?: { secret?: string; verify?: boolean }):
    | { type: 'payment.status_changed'; payment: Payment }
    | { type: 'unknown'; data: null };
}

export function normalizePaymentStatus(apiStatus: string): PaymentStatus;
export function normalizePayment(api: Record<string, unknown>): Payment;
export function normalizeInvoice(api: Record<string, unknown>): Invoice;
export function normalizeEstimate(api: Record<string, unknown>): Estimate;
export function normalizeMinimumAmount(api: Record<string, unknown>): MinimumAmount;
export function normalizeCurrencies(api: unknown): Currency[];

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

export function sortObjectDeep<T>(value: T): T;
export function createWebhookSignature(payload: Record<string, unknown>, secret: string): string;
export function verifyWebhookSignature(payload: Record<string, unknown>, signature: string, secret: string): boolean;
export function normalizeWebhook(payload: Record<string, unknown>):
  | { type: 'payment.status_changed'; payment: Payment }
  | { type: 'unknown'; data: null };

export default NowPaymentsSDK;
