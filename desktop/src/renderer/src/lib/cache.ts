// Tiny stale-while-revalidate cache backed by localStorage. Values are kept
// indefinitely (last-known-good) and always revalidated in the background, so a
// screen paints instantly from cache instead of flashing empty during a fetch.

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
    // quota exceeded or unserializable — caching is best-effort, ignore.
  }
}
