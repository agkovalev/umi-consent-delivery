import { performance } from 'node:perf_hooks';

// One process, one fixed window. The global cap bounds the site map as well.
export class RequestLimits {
  private resetAt: number;
  private total = 0;
  private sites = new Map<string, number>();
  constructor(private now = () => performance.now(), private windowMs = 60_000,
    private globalMax = 600, private siteMax = 60) {
    for (const value of [windowMs, globalMax, siteMax]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid request limit');
    }
    this.resetAt = now() + windowMs;
  }
  private refresh() {
    if (this.now() >= this.resetAt) {
      this.resetAt = this.now() + this.windowMs;
      this.total = 0;
      this.sites.clear();
    }
  }
  global() {
    this.refresh();
    if (this.total >= this.globalMax) return this.retryAfter();
    this.total++;
    return 0;
  }
  site(id: string) {
    this.refresh();
    const count = this.sites.get(id) ?? 0;
    if (count >= this.siteMax) return this.retryAfter();
    this.sites.set(id, count + 1);
    return 0;
  }
  private retryAfter() { return Math.max(1, Math.ceil((this.resetAt - this.now()) / 1000)); }
}
