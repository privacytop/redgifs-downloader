import { useCallback, useEffect, useRef, useState } from 'react'
import type { Content, ContentResponse } from '@redloader/core'
import { readCache, writeCache } from '../lib/cache'

export interface PagedFeed {
  items: Content[]
  loading: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  reload: () => void
  /** Returns the next page's fresh items — handed to the player to keep paging. */
  loadMoreItems: () => Promise<Content[]>
}

/**
 * One paginator driving both the grid and the swipe player. Fetches pages via
 * `fetcher`, dedupes by id, and resets when `deps` change. When a `cacheKey` is
 * given, page 1 is persisted and painted instantly on the next visit
 * (stale-while-revalidate) so switching tabs never flashes an empty loader.
 */
export function usePagedFeed(
  fetcher: (page: number) => Promise<ContentResponse>,
  deps: unknown[] = [],
  cacheKey?: string
): PagedFeed {
  const cacheKeyRef = useRef(cacheKey)
  cacheKeyRef.current = cacheKey

  const [items, setItems] = useState<Content[]>(() =>
    cacheKey ? (readCache<Content[]>(cacheKey) ?? []) : []
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pageRef = useRef(0)
  const pagesRef = useRef(1)
  const seen = useRef<Set<string>>(new Set())
  const runId = useRef(0)
  const loadingRef = useRef(false)

  const loadNext = useCallback(async (): Promise<Content[]> => {
    if (loadingRef.current) return []
    if (pageRef.current > 0 && pageRef.current >= pagesRef.current) return []
    const myRun = runId.current
    const next = pageRef.current + 1
    loadingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const r = await fetcher(next)
      if (myRun !== runId.current) return []
      pageRef.current = r.page || next
      pagesRef.current = r.pages || pageRef.current
      const fresh = (r.contents || []).filter((c) => !seen.current.has(c.id))
      fresh.forEach((c) => seen.current.add(c.id))
      if (next === 1) {
        setItems(fresh)
        if (cacheKeyRef.current) writeCache(cacheKeyRef.current, fresh)
      } else if (fresh.length) {
        setItems((prev) => [...prev, ...fresh])
      }
      return fresh
    } catch (e) {
      if (myRun === runId.current) setError(e instanceof Error ? e.message : String(e))
      return []
    } finally {
      if (myRun === runId.current) {
        loadingRef.current = false
        setLoading(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const loadNextRef = useRef(loadNext)
  loadNextRef.current = loadNext

  const reset = useCallback(() => {
    runId.current += 1
    pageRef.current = 0
    pagesRef.current = 1
    seen.current = new Set()
    loadingRef.current = false
    // Paint the cached page-1 immediately (no empty flash), then revalidate.
    setItems(cacheKeyRef.current ? (readCache<Content[]>(cacheKeyRef.current) ?? []) : [])
    setError(null)
    void loadNextRef.current()
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, deps)

  return {
    items,
    loading,
    error,
    hasMore: pageRef.current < pagesRef.current,
    loadMore: () => void loadNext(),
    reload: reset,
    loadMoreItems: loadNext
  }
}
