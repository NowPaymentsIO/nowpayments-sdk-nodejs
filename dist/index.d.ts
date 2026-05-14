export type SDKErrorType = 'configuration' | 'validation' | 'network' | 'timeout' | 'api' | 'unknown';

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'paid'
  | 'partially_paid'
  | 'failed'
  | 'refunded'
  | 'expired'
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
  apiKey: string;
  ipnSecret?: string;
  jwtToken?: string;
  token?: string;
  email?: string;
  password?: string;
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
  amount: number;
  currency: string;
  payCurrency?: string;
  payoutCurrency?: string;
  orderId?: string;
  description?: string;
  orderDescription?: string;
  ipnCallbackUrl?: string;
  successUrl?: string;
  cancelUrl?: string;
  partiallyPaidUrl?: string;
  fixedRate?: boolean;
  feePaidByUser?: boolean;
  isFixedRate?: boolean;
  isFeePaidByUser?: boolean;
  skipPreflight?: boolean;
}

export interface DirectPaymentInput extends CheckoutInput {
  payCurrency: string;
  payAmount?: number;
  payoutAddress?: string;
  payoutExtraId?: string | null;
  originIp?: string;
}

export interface EstimateInput {
  amount: number;
  fromCurrency?: string;
  currencyFrom?: string;
  toCurrency?: string;
  currencyTo?: string;
}

export interface MinimumAmountInput {
  fromCurrency?: string;
  currencyFrom?: string;
  toCurrency?: string;
  currencyTo?: string;
  fiatEquivalent?: string;
  fixedRate?: boolean;
  feePaidByUser?: boolean;
  isFixedRate?: boolean;
  isFeePaidByUser?: boolean;
}

export interface InvoicePaymentInput {
  invoiceId: string;
  iid?: string;
  payCurrency: string;
  purchaseId?: string;
  description?: string;
  orderDescription?: string;
  customerEmail?: string;
  payoutAddress?: string;
  payoutExtraId?: string | null;
  payoutCurrency?: string;
  originIp?: string;
}

export interface Estimate {
  amount: number | null;
  from: {
    amount: number | null;
    currency: string | null;
  };
  to: {
    currency: string | null;
  };
}

export interface MinimumAmount {
  amount: number | null;
  fromCurrency: string | null;
  toCurrency: string | null;
  fiatEquivalent: number | null;
}

export interface Invoice {
  id: string | null;
  checkoutUrl: string | null;
  amount: {
    value: number | null;
    currency: string | null;
  };
  paymentCurrency: string | null;
  order: {
    id: string | null;
    description: string | null;
  };
  redirects: {
    successUrl: string | null;
    cancelUrl: string | null;
    partiallyPaidUrl: string | null;
  };
  callbacks: {
    ipnUrl: string | null;
  };
  fixedRate: boolean | null;
  feePaidByUser: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Payment {
  id: string | null;
  invoiceId: string | null;
  status: PaymentStatus;
  deposit: {
    address: string | null;
    memo: string | null;
    network: string | null;
    precision: number | null;
  };
  price: {
    amount: number | null;
    currency: string | null;
  };
  payment: {
    amount: number | null;
    currency: string | null;
    actuallyPaid: number | null;
  };
  outcome: {
    amount: number | null;
    currency: string | null;
  };
  order: {
    id: string | null;
    description: string | null;
  };
  purchaseId: string | null;
  callbackUrl: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  estimate?: Estimate | null;
  minimum?: MinimumAmount | null;
}

export interface CheckoutSession {
  id: string | null;
  checkoutUrl: string | null;
  status: 'pending';
  invoice: Invoice;
  payment: Payment | null;
  estimate: Estimate | null;
  minimum: MinimumAmount | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PaymentsListQuery {
  limit?: number;
  page?: number;
  sortBy?: string;
  orderBy?: 'asc' | 'desc';
  dateFrom?: string;
  dateTo?: string;
  invoiceId?: string | number;
}

export interface PaymentsList {
  items: Payment[];
  page: number | null;
  limit: number | null;
  total: number | null;
  pagesCount: number | null;
}

export interface Currency {
  code: string;
  name: string | null;
  enabled: boolean | null;
  network: string | null;
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
  getFullCurrencies(): Promise<unknown>;
  createInvoice(body: Record<string, unknown>): Promise<unknown>;
  createPayment(body: Record<string, unknown>, options?: { originIp?: string }): Promise<unknown>;
  createPaymentByInvoice(body: Record<string, unknown>, options?: { originIp?: string }): Promise<unknown>;
  updatePaymentEstimate(paymentId: string): Promise<unknown>;
  getPaymentStatus(paymentId: string): Promise<unknown>;
  listPayments(query?: Record<string, unknown>): Promise<unknown>;
}

export class NowPaymentsSDK {
  raw: RawClient;
  constructor(options: NowPaymentsSDKOptions);
  setJwtToken(token: string | null): this;
  getApiStatus(): Promise<unknown>;
  authenticate(credentials?: { email?: string; password?: string }): Promise<string | null>;
  estimatePrice(input: EstimateInput): Promise<Estimate>;
  getMinimumPaymentAmount(input: MinimumAmountInput): Promise<MinimumAmount>;
  getAvailableCurrencies(options?: { onlyEnabled?: boolean }): Promise<Currency[]>;
  createInvoice(input: CheckoutInput): Promise<Invoice>;
  createPaymentFromInvoice(input: InvoicePaymentInput): Promise<Payment>;
  createDirectPayment(input: DirectPaymentInput): Promise<Payment>;
  createPayment(input: CheckoutInput): Promise<CheckoutSession>;
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  createHostedCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  refreshPaymentEstimate(paymentId: string): Promise<{ paymentId: string; amount: number | null; expiresAt: string | null }>;
  getPaymentStatus(paymentId: string): Promise<Payment>;
  listPayments(query?: PaymentsListQuery): Promise<PaymentsList>;
  watchPaymentStatus(paymentId: string, options?: WatchPaymentStatusOptions): PaymentStatusWatcher;
  onPaymentStatusChange(
    paymentId: string,
    callback: (event: { from: PaymentStatus; to: PaymentStatus; payment: Payment }) => void,
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
