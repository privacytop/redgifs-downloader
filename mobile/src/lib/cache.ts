// Tiny synchronous stale-while-revalidate cache backed by localStorage (the
// WebView persists it). Feeds paint their last page-1 instantly on tab switch,
// then revalidate — so switching tabs never shows a bare "Loading…".

const PREFIX = 'swr:'

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeCache<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* quota / unavailable — non-fatal */
  }
}
