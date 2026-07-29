import { EventEmitter } from 'node:events';
import { TERMINAL_PAYOUT_STATUSES } from './normalizers.js';

export class PayoutStatusWatcher extends EventEmitter {
  constructor({ sdk, payoutId, intervalMs = 5000, timeoutMs, terminalStatuses = TERMINAL_PAYOUT_STATUSES } = {}) {
    super();
    this.sdk = sdk;
    this.payoutId = String(payoutId);
    this.intervalMs = Math.max(1000, Number(intervalMs) || 5000);
    this.timeoutMs = timeoutMs == null ? undefined : Number(timeoutMs);
    this.terminalStatuses = new Set(terminalStatuses);
    this.timer = null;
    this.timeoutTimer = null;
    this.stopped = false;
    this.lastStatus = null;
    this._changeEverFired = false;
  }

  start() {
    if (this.timer || this.stopped) return this;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);

    if (this.timeoutMs && Number.isFinite(this.timeoutMs) && this.timeoutMs > 0) {
      this.timeoutTimer = setTimeout(() => {
        this.emit('timeout', { payoutId: this.payoutId });
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
      const payout = await this.sdk.getPayoutStatus(this.payoutId);
      if (this.stopped) return;

      this.emit('status', payout);
      if (this.lastStatus && this.lastStatus !== payout.status) {
        this._changeEverFired = true;
        this.emit('change', { from: this.lastStatus, to: payout.status, payout });
      }
      this.lastStatus = payout.status;

      if (this.terminalStatuses.has(payout.status)) {
        this.emit('terminal', payout);
        this.stop();
      }
    } catch (error) {
      if (!this.stopped) this.emit('error', error);
    }
  }
}
