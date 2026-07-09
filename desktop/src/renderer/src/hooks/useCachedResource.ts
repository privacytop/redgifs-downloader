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
  // Start `loading` true when there is no cache to paint, so first-ever visits
  // show the skeleton from the very first frame instead of flashing "empty".
  const [loading, setLoading] = useState(() => readCache<T>(key) == null)
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

  // Always call the latest fetcher: deps can change (auth, tab gating) without
  // the key changing, and a refresh memoized on [key] alone would re-run a
  // stale closure — e.g. a sign-in that leaves a gated tab permanently empty.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // Generation counter: a slow response from a superseded key/deps run must
  // not clobber the current one (shapes differ per key — it could crash).
  const genRef = useRef(0)

  const refresh = useCallback(() => {
    const gen = ++genRef.current
    setLoading(true)
    fetcherRef
      .current()
      .then((d) => {
        if (gen !== genRef.current) return
        setData(d)
        writeCache(keyRef.current, d)
        setError(null)
      })
      .catch((e) => {
        if (gen !== genRef.current) return
        setError((e as Error).message)
      })
      .finally(() => {
        if (gen === genRef.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    setData(readCache<T>(key)) // show this key's cache immediately
    refresh() // then revalidate
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error, refresh }
}
