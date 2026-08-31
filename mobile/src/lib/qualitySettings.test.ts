import { describe, expect, it } from 'vitest'
import {
  normalizeQuality,
  normalizeStreamQuality,
  resolveStreamQuality
} from './qualitySettings'

describe('streaming quality', () => {
  it('uses SD in Android low-data mode when set to Auto', () => {
    expect(resolveStreamQuality('auto', true)).toBe('sd')
  })

  it('uses HD outside low-data mode and respects explicit overrides', () => {
    expect(resolveStreamQuality('auto', false)).toBe('hd')
    expect(resolveStreamQuality('hd', true)).toBe('hd')
    expect(resolveStreamQuality('sd', false)).toBe('sd')
  })

  it('normalizes corrupted persisted values', () => {
    expect(normalizeStreamQuality('ultra')).toBe('auto')
    expect(normalizeQuality('ultra')).toBe('hd')
  })
})
