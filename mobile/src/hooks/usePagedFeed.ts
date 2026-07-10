import { useCallback, useEffect, useRef, useState } from 'react'
import type { Content, ContentResponse } from '@redloader/core'

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
 * `fetcher`, dedupes by id, and resets when `deps` change. The player is opened
 * with `items` + `loadMoreItems` so swiping past the end keeps loading.
 */
export function usePagedFeed(
  fetcher: (page: number) => Promise<ContentResponse>,
  deps: unknown[] = []
): PagedFeed {
  const [items, setItems] = useState<Content[]>([])
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
      setItems((prev) => (next === 1 ? fresh : [...prev, ...fresh]))
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
    setItems([])
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
