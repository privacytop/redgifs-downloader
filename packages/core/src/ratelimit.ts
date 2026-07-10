/**
 * Minimal adaptive rate limiter: spaces requests by a minimum interval and
 * honours 429 Retry-After by pausing until a backoff deadline. Shared by the
 * API client and the downloader.
 */
export class RateLimiter {
  private lastRequest = 0
  private backoffUntil = 0

  constructor(private minIntervalMs = 120) {}

  async wait(): Promise<void> {
    const now = Date.now()
    const until = Math.max(this.backoffUntil, this.lastRequest + this.minIntervalMs)
    if (until > now) {
      await new Promise((r) => setTimeout(r, until - now))
    }
    this.lastRequest = Date.now()
  }

  /** Called on HTTP 429. `retryAfterMs` comes from the API delay/Retry-After. */
  note429(retryAfterMs: number): void {
    const delay = retryAfterMs > 0 ? retryAfterMs : 60_000
    this.backoffUntil = Date.now() + delay
  }
}
