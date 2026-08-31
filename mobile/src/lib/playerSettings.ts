export const MIN_VIDEO_POOL_SIZE = 3
export const MAX_VIDEO_POOL_SIZE = 250
export const DEFAULT_VIDEO_POOL_SIZE = 6

export function normalizeVideoPoolSize(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_VIDEO_POOL_SIZE
  return Math.min(MAX_VIDEO_POOL_SIZE, Math.max(MIN_VIDEO_POOL_SIZE, Math.round(numeric)))
}
