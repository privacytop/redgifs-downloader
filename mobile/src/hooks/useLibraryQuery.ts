import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Content } from '@redloader/core'
import { storage, type LibraryQuery } from '../lib/storage'

export interface LibraryResult {
  items: Content[]
  total: number
  loading: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  /** Next page's items — handed to the player so swiping keeps paging. */
  loadMoreItems: () => Promise<Content[]>
  reload: () => void
}

/**
 * Paged, SQL-backed view over the offline index. Every change of `query`
 * re-runs page 1 (LIMIT/OFFSET in sqlite — never a full-table JSON parse);
 * scrolling appends further pages. `query` must be referentially stable
 * between renders when unchanged (memoise it).
 */
export function useLibraryQuery(query: LibraryQuery, pageSize = 60): LibraryResult {
  const [items, setItems] = useState<Content[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const runId = useRef(0)
  const offsetRef = useRef(0)
  const totalRef = useRef(0)
  const loadingRef = useRef(false)
  const inflight = useRef<Promise<Content[]> | null>(null)
  const queryRef = useRef(query)
  queryRef.current = query

  useEffect(() => {
    const my = ++runId.current
    offsetRef.current = 0
    totalRef.current = 0
    inflight.current = null
    loadingRef.current = true
    setLoading(true)
    setError(null)
    storage
      .queryLibrary(query, pageSize, 0)
      .then((r) => {
        if (my !== runId.current) return
        setItems(r.items)
        setTotal(r.total)
        totalRef.current = r.total
        offsetRef.current = r.items.length
      })
      .catch((e) => {
        if (my !== runId.current) return
        setItems([])
        setTotal(0)
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (my === runId.current) {
          loadingRef.current = false
          setLoading(false)
        }
      })
  }, [query, pageSize, version])

  const loadMoreItems = useCallback((): Promise<Content[]> => {
    if (loadingRef.current && inflight.current) return inflight.current
    if (loadingRef.current || offsetRef.current >= totalRef.current) return Promise.resolve([])
    const my = runId.current
    loadingRef.current = true
    setLoading(true)
    const p = storage
      .queryLibrary(queryRef.current, pageSize, offsetRef.current)
      .then((r) => {
        if (my !== runId.current) return []
        totalRef.current = r.total
        setTotal(r.total)
        offsetRef.current += r.items.length
        if (r.items.length) {
          setItems((prev) => {
            const seen = new Set(prev.map((c) => c.id))
            return [...prev, ...r.items.filter((c) => !seen.has(c.id))]
          })
        }
        return r.items
      })
      .catch(() => [])
      .finally(() => {
        if (my === runId.current) {
          loadingRef.current = false
          inflight.current = null
          setLoading(false)
        }
      })
    inflight.current = p
    return p
  }, [pageSize])

  const loadMore = useCallback((): void => void loadMoreItems(), [loadMoreItems])
  const reload = useCallback((): void => setVersion((v) => v + 1), [])

  return useMemo<LibraryResult>(
    () => ({
      items,
      total,
      loading,
      error,
      hasMore: items.length < total,
      loadMore,
      loadMoreItems,
      reload
    }),
    [items, total, loading, error, loadMore, loadMoreItems, reload]
  )
}
