import { useCallback, useEffect, useRef, useState } from 'react'
import { readCache, writeCache } from '../lib/cache'

export interface CachedResource<T> {
  /** Cached value shown immediately, replaced by fresh data when it arrives. */
  data: T | null
  loading: boolean
  error: string | null
  refresh: () => void
}

/**
 * Stale-while-revalidate for a single async resource: returns the cached value
 * for `key` synchronously (no empty flash), then fetches fresh and swaps it in,
 * persisting the result. Re-runs when `deps` change.
 */
export function useCachedResource<T>(
  key: string,
  fetcher: () => Promise<T>,
  deps: unknown[] = []
): CachedResource<T> {
  const [data, setData] = useState<T | null>(() => readCache<T>(key))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // When `key` changes, the effect that swaps in the new value runs *after*
  // render — leaving one render where `data` still holds the previous key's
  // value, which may be a different shape (e.g. Niche[] vs string[]) and crash
  // the consumer. Swap synchronously here so the render matching the new key
  // always sees the new key's cache (or null), never the stale one.
  const keyRef = useRef(key)
  if (keyRef.current !== key) {
    keyRef.current = key
    setData(readCache<T>(key))
  }

  const refresh = useCallback(() => {
    setLoading(true)
    fetcher()
      .then((d) => {
        setData(d)
        writeCache(key, d)
        setError(null)
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    setData(readCache<T>(key)) // show this key's cache immediately
    refresh() // then revalidate
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error, refresh }
}
