import { useCallback, useEffect, useRef, useState } from 'react'
import { readCache, writeCache } from '../lib/cache'

export interface CachedResource<T> {
  data: T | null
  loading: boolean
  error: string | null
  refresh: () => void
}

/**
 * Stale-while-revalidate for a single async resource (Discover creators/niches,
 * collections, profile…). Returns the cached value for `key` synchronously so
 * a tab switch never flashes a loader, then revalidates and swaps in fresh
 * data. Re-runs when `key` or `deps` change; keeps the latest fetcher in a ref
 * so deps that change without the key (e.g. auth) still refetch correctly.
 */
export function useCachedResource<T>(
  key: string,
  fetcher: () => Promise<T>,
  deps: unknown[] = []
): CachedResource<T> {
  const [data, setData] = useState<T | null>(() => readCache<T>(key))
  const [loading, setLoading] = useState(() => data == null)
  const [error, setError] = useState<string | null>(null)

  const keyRef = useRef(key)
  keyRef.current = key
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const gen = useRef(0)

  const refresh = useCallback(() => {
    const my = ++gen.current
    const k = keyRef.current
    setLoading(true)
    fetcherRef
      .current()
      .then((d) => {
        if (my !== gen.current) return
        setData(d)
        writeCache(k, d)
        setError(null)
      })
      .catch((e) => {
        if (my === gen.current) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (my === gen.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    // A new key paints ITS cached value (never the previous key's data), then
    // revalidates.
    setData(readCache<T>(key))
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps])

  return { data, loading, error, refresh }
}
