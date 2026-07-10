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

  it('honours a 429 backoff', async () => {
    const rl = new RateLimiter(1)
    rl.note429(60)
    const t0 = Date.now()
    await rl.wait()
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50)
  })
})
