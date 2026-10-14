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

export function removeCache(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    /* non-fatal */
  }
}

// Cache keys that hold ONE account's data. Dropped on sign-out so the next
// account never paints the previous one's collections, likes or profile.
const USER_SCOPED_PREFIXES = ['collections', 'me:profile', 'feed:likes', 'feed:for-you', 'feed:collection:', 'library:', 'likedIds', 'blockedTags']

export function clearUserCaches(): void {
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(PREFIX)) continue
      const bare = k.slice(PREFIX.length)
      if (USER_SCOPED_PREFIXES.some((p) => bare.startsWith(p))) doomed.push(k)
    }
    doomed.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* non-fatal */
  }
}
