import { describe, expect, it } from 'vitest'
import { formatCount, formatDuration, formatSize } from './format'

describe('mobile formatting', () => {
  it('formats compact counts around unit boundaries', () => {
    expect(formatCount(1_234)).toBe('1.2K')
    expect(formatCount(12_000_000)).toBe('12M')
  })

  it('formats duration and byte sizes', () => {
    expect(formatDuration(3661)).toBe('1:01:01')
    expect(formatSize(1536)).toBe('1.5 KB')
  })
})
