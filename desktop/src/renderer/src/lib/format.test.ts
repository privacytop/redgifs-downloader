import { describe, expect, it } from 'vitest'
import { formatCount, formatDuration, formatSize } from './format'

describe('renderer formatting', () => {
  it('formats compact counts and invalid input', () => {
    expect(formatCount(1_234)).toBe('1.2K')
    expect(formatCount(12_000_000)).toBe('12M')
    expect(formatCount(Number.NaN)).toBe('0')
  })

  it('formats durations across the hour boundary', () => {
    expect(formatDuration(59.6)).toBe('1:00')
    expect(formatDuration(3661)).toBe('1:01:01')
  })

  it('formats binary file sizes', () => {
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(0)).toBe('0 B')
  })
})
