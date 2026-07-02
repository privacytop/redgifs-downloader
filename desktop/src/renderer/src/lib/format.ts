// Formatting helpers for the renderer. All rounded — no float artifacts.

/** Compact view/count formatter: 1234 → 1.2K, 3_400_000 → 3.4M, 12_000_000 → 12M. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return trimZero(n / 1_000_000_000, abs >= 10_000_000_000) + 'B'
  if (abs >= 1_000_000) return trimZero(n / 1_000_000, abs >= 10_000_000) + 'M'
  if (abs >= 1_000) return trimZero(n / 1_000, abs >= 10_000) + 'K'
  return String(Math.round(n))
}

/** Alias for count formatting used on views. */
export function formatViews(n: number): string {
  return formatCount(n)
}

/** Human file size: 0 B, 940 B, 1.4 KB, 3.2 MB, 5.1 GB. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  // Whole bytes stay integer; larger units get one decimal (trimmed).
  const rounded = i === 0 ? Math.round(v) : trimZero(v, v >= 100)
  return `${rounded} ${units[i]}`
}

/** Duration in seconds → mm:ss (or h:mm:ss when ≥ 1h). */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (x: number): string => String(x).padStart(2, '0')
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${m}:${pad(s)}`
}

/**
 * Round to at most one decimal, dropping a trailing `.0`.
 * `whole=true` forces an integer (used for the 10K–1M / 10M+ ranges).
 */
function trimZero(v: number, whole: boolean): string {
  if (whole) return String(Math.round(v))
  const r = Math.round(v * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}
