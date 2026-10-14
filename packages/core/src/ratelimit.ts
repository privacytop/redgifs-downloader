/**
 * Minimal adaptive rate limiter shared by the API client and the downloader.
 *
 * - `wait()` RESERVES a send slot synchronously (before sleeping), so N
 *   concurrent callers are spaced `minIntervalMs` apart instead of all waking
 *   on the same deadline and bursting together (which is what used to trigger
 *   the next 429 right after a backoff).
 * - `note429()` pauses everyone until a backoff deadline. A server-provided
 *   delay wins (clamped); without one the pause grows 1s → 2s → 4s → 8s → 10s
 *   per consecutive strike rather than a flat 60s that froze the whole app.
 */
export class RateLimiter {
  private nextSlot = 0
  private backoffUntil = 0
  private strikes = 0
  private minIntervalMs: number

  // Field assigned in the body (not a parameter property) so this class is
  // erasable-syntax-clean and compiles under the mobile app's strict tsconfig.
  constructor(minIntervalMs = 120) {
    this.minIntervalMs = minIntervalMs
  }

  async wait(): Promise<void> {
    const now = Date.now()
    const slot = Math.max(now, this.backoffUntil, this.nextSlot)
    this.nextSlot = slot + this.minIntervalMs
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now))
  }

  /** Called on HTTP 429. `retryAfterMs` comes from Retry-After / error.delay. */
  note429(retryAfterMs?: number): void {
    const hinted = retryAfterMs && retryAfterMs > 0 ? Math.min(retryAfterMs, MAX_HINTED_MS) : 0
    this.strikes = Math.min(this.strikes + 1, 5)
    const fallback = Math.min(1000 * 2 ** (this.strikes - 1), MAX_FALLBACK_MS)
    this.backoffUntil = Date.now() + (hinted || fallback)
  }

  /** A successful response resets the exponential ladder. */
  noteOk(): void {
    this.strikes = 0
  }

  /** Milliseconds until requests may flow again (0 when not backing off). */
  backoffRemaining(): number {
    return Math.max(0, this.backoffUntil - Date.now())
  }
}

const MAX_HINTED_MS = 30_000
const MAX_FALLBACK_MS = 10_000
