import type { Quality } from '@redloader/core'

export type StreamQuality = Quality | 'auto'

export function normalizeQuality(value: unknown, fallback: Quality = 'hd'): Quality {
  return value === 'sd' || value === 'hd' ? value : fallback
}

export function normalizeStreamQuality(value: unknown): StreamQuality {
  return value === 'sd' || value === 'hd' || value === 'auto' ? value : 'auto'
}

export function resolveStreamQuality(value: StreamQuality, lowDataMode: boolean): Quality {
  return value === 'auto' ? (lowDataMode ? 'sd' : 'hd') : value
}
