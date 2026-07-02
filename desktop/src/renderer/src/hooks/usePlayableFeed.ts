import { useCallback, useEffect, useRef, useState } from 'react'
import type { Content, ContentResponse } from '@shared/types'
import { usePlayer } from '../player/PlayerProvider'

export interface PlayableFeed {
  contents: Content[]
  loading: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  reload: () => void
  /** Open the immersive player at a given item, wired to keep paginating. */
  openAt: (content: Content, index: number) => void
}

/**
 * One paginator that drives both a `FeedGrid` and the immersive player.
 *
 * The grid reads `contents`/`hasMore`/`loadMore`; the player is opened via
 * `openAt`, which hands it the same live list plus a `loadMore` that returns the
 * next page's fresh items — so scrolling in the player keeps loading. Dedupes by
 * id across pages. Resets when `deps` change.
 */
export function usePlayableFeed(
  fetcher: (page: number) => Promise<ContentResponse>,
  label: string,
  deps: unknown[] = [],
  opts?: { nicheId?: string }
): PlayableFeed {
  const player = usePlayer()
  const [contents, setContents] = useState<Content[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pageRef = useRef(0)
  const pagesRef = useRef(1)
  const seen = useRef<Set<string>>(new Set())
  const runId = useRef(0)

  const loadNext = useCallback(async (): Promise<Content[]> => {
    if (loading) return []
    if (pageRef.current > 0 && pageRef.current >= pagesRef.current) return []
    const myRun = runId.current
    const next = pageRef.current + 1
    setLoading(true)
    setError(null)
    try {
      const r = await fetcher(next)
      if (myRun !== runId.current) return [] // superseded by a reset
      pageRef.current = r.page || next
      pagesRef.current = r.pages || pageRef.current
      const fresh = (r.contents || []).filter((c) => !seen.current.has(c.id))
      fresh.forEach((c) => seen.current.add(c.id))
      if (fresh.length) setContents((prev) => [...prev, ...fresh])
      return fresh
    } catch (e) {
      if (myRun === runId.current) setError((e as Error).message)
      return []
    } finally {
      if (myRun === runId.current) setLoading(false)
    }
  }, [fetcher, loading])

  const reset = useCallback(() => {
    runId.current += 1
    pageRef.current = 0
    pagesRef.current = 1
    seen.current = new Set()
    setContents([])
    setError(null)
    void loadNext()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, deps)

  const hasMore = pageRef.current < pagesRef.current

  const openAt = useCallback(
    (_content: Content, index: number): void => {
      player.open({ items: contents, index, label, loadMore: loadNext, nicheId: opts?.nicheId })
    },
    [player, contents, label, loadNext, opts?.nicheId]
  )

  return { contents, loading, error, hasMore, loadMore: () => void loadNext(), reload: reset, openAt }
}
