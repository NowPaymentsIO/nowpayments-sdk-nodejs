import { EventEmitter } from 'node:events';
import { TERMINAL_PAYMENT_STATUSES } from './normalizers.js';

export class PaymentStatusWatcher extends EventEmitter {
  constructor({ sdk, paymentId, intervalMs = 5000, timeoutMs, terminalStatuses = TERMINAL_PAYMENT_STATUSES } = {}) {
    super();
    this.sdk = sdk;
    this.paymentId = String(paymentId);
    this.intervalMs = Math.max(1000, Number(intervalMs) || 5000);
    this.timeoutMs = timeoutMs == null ? undefined : Number(timeoutMs);
    this.terminalStatuses = new Set(terminalStatuses);
    this.timer = null;
    this.timeoutTimer = null;
    this.stopped = false;
    this.lastStatus = null;
    // Tracks whether a 'change' event has ever been emitted for this watcher.
    // Used by onPaymentStatusChange to avoid double-invoking the callback when
    // 'change' and 'terminal' fire in the same poll cycle.
    this._changeEverFired = false;
  }

  start() {
    if (this.timer || this.stopped) return this;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);

    if (this.timeoutMs && Number.isFinite(this.timeoutMs) && this.timeoutMs > 0) {
      this.timeoutTimer = setTimeout(() => {
        this.emit('timeout', { paymentId: this.paymentId });
        this.stop();
      }, this.timeoutMs);
    }

    return this;
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.timer = null;
    this.timeoutTimer = null;
    return this;
  }

  async poll() {
    try {
      const payment = await this.sdk.getPaymentStatus(this.paymentId);
      if (this.stopped) return;

      this.emit('status', payment);
      if (this.lastStatus && this.lastStatus !== payment.status) {
        this._changeEverFired = true;
        this.emit('change', { from: this.lastStatus, to: payment.status, payment });
      }
      this.lastStatus = payment.status;

      if (this.terminalStatuses.has(payment.status)) {
        this.emit('terminal', payment);
        this.stop();
      }
    } catch (error) {
      if (!this.stopped) this.emit('error', error);
    }
  }
}
