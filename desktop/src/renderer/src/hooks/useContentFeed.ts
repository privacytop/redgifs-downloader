import { useCallback, useEffect, useRef, useState } from 'react'
import type { Content, ContentResponse } from '@shared/types'

export interface ContentFeed {
  contents: Content[]
  loading: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  reload: () => void
}

/**
 * Paged content feed. Loads page 1 on mount and whenever `deps` change.
 * `loadMore` fetches the next page and appends (deduped by id).
 * `hasMore` is true when the last page returned items AND page < pages.
 * Never throws — failures land in `error`.
 */
export function useContentFeed(
  fetcher: (page: number) => Promise<ContentResponse>,
  deps: unknown[] = []
): ContentFeed {
  const [contents, setContents] = useState<Content[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  // Latest page fetched and total pages known so far.
  const pageRef = useRef(0)
  const pagesRef = useRef(1)
  // Guard against races: only the newest run may commit state.
  const runRef = useRef(0)
  // Keep the current fetcher without making it a hook dependency (callers often
  // pass an inline closure that changes identity every render).
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const run = useCallback(async (page: number, append: boolean): Promise<void> => {
    const run = ++runRef.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetcherRef.current(page)
      if (run !== runRef.current) return // superseded
      const incoming = res.contents ?? []
      pageRef.current = res.page || page
      pagesRef.current = res.pages || 1
      setContents((prev) => {
        if (!append) return incoming
        const seen = new Set(prev.map((c) => c.id))
        return [...prev, ...incoming.filter((c) => !seen.has(c.id))]
      })
      setHasMore(incoming.length > 0 && pageRef.current < pagesRef.current)
    } catch (e) {
      if (run !== runRef.current) return
      setError(e instanceof Error ? e.message : String(e))
      if (!append) setContents([])
      setHasMore(false)
    } finally {
      if (run === runRef.current) setLoading(false)
    }
  }, [])

  const loadMore = useCallback((): void => {
    if (loading || !hasMore) return
    void run(pageRef.current + 1, true)
  }, [loading, hasMore, run])

  const reload = useCallback((): void => {
    pageRef.current = 0
    pagesRef.current = 1
    void run(1, false)
  }, [run])

  useEffect(() => {
    pageRef.current = 0
    pagesRef.current = 1
    void run(1, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { contents, loading, error, hasMore, loadMore, reload }
}
