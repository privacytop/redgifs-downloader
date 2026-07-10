// Compact formatting helpers (ported from desktop lib/format).

export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  const abs = Math.abs(n)
  const trim = (v: number, whole: boolean): string => {
    if (whole) return String(Math.round(v))
    const r = Math.round(v * 10) / 10
    return Number.isInteger(r) ? String(r) : r.toFixed(1)
  }
  if (abs >= 1_000_000_000) return trim(n / 1_000_000_000, abs >= 10_000_000_000) + 'B'
  if (abs >= 1_000_000) return trim(n / 1_000_000, abs >= 10_000_000) + 'M'
  if (abs >= 1_000) return trim(n / 1_000, abs >= 10_000) + 'K'
  return String(Math.round(n))
}

export const formatViews = formatCount

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (x: number): string => String(x).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
