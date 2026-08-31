import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIDEO_POOL_SIZE,
  MAX_VIDEO_POOL_SIZE,
  MIN_VIDEO_POOL_SIZE,
  normalizeVideoPoolSize
} from './playerSettings'

describe('normalizeVideoPoolSize', () => {
  it('accepts large configurable pools', () => {
    expect(normalizeVideoPoolSize(100)).toBe(100)
    expect(normalizeVideoPoolSize('175')).toBe(175)
  })

  it('clamps unsafe bounds and rounds fractions', () => {
    expect(normalizeVideoPoolSize(0)).toBe(MIN_VIDEO_POOL_SIZE)
    expect(normalizeVideoPoolSize(10_000)).toBe(MAX_VIDEO_POOL_SIZE)
    expect(normalizeVideoPoolSize(12.6)).toBe(13)
  })

  it('uses the safe default for invalid values', () => {
    expect(normalizeVideoPoolSize('nope')).toBe(DEFAULT_VIDEO_POOL_SIZE)
  })
})
