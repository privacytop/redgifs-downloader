import { describe, it, expect } from 'vitest'
import { RateLimiter } from './ratelimit'

describe('RateLimiter', () => {
  it('spaces requests by the minimum interval', async () => {
    const rl = new RateLimiter(50)
    const t0 = Date.now()
    await rl.wait() // first is immediate
    await rl.wait() // second waits ~50ms
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45)
  })

  it('reserves slots so concurrent callers are spaced, not burst', async () => {
    const rl = new RateLimiter(40)
    const t0 = Date.now()
    const done: number[] = []
    await Promise.all([1, 2, 3].map(() => rl.wait().then(() => done.push(Date.now() - t0))))
    done.sort((a, b) => a - b)
    expect(done[2]).toBeGreaterThanOrEqual(70) // third slot ≈ 80ms, not 0
  })

  it('honours a server-hinted 429 backoff', async () => {
    const rl = new RateLimiter(1)
    rl.note429(60)
    const t0 = Date.now()
    await rl.wait()
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50)
  })

  it('backs off exponentially (not 60s) when the server gives no delay', () => {
    const rl = new RateLimiter(1)
    rl.note429()
    expect(rl.backoffRemaining()).toBeLessThanOrEqual(1000)
    rl.note429()
    expect(rl.backoffRemaining()).toBeGreaterThan(1500)
    rl.noteOk()
    rl.note429()
    expect(rl.backoffRemaining()).toBeLessThanOrEqual(1000)
  })

  it('clamps an absurd server delay', () => {
    const rl = new RateLimiter(1)
    rl.note429(10 * 60 * 1000)
    expect(rl.backoffRemaining()).toBeLessThanOrEqual(30_000)
  })
})
