import { useCallback, useEffect, useRef, useState } from 'react'
import type { Content, ContentResponse } from '@shared/types'
import { usePlayer } from '../player/PlayerProvider'
import { useBlockedTags } from '../context/blockedTags'
import { readCache, writeCache } from '../lib/cache'

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
  const { isBlocked } = useBlockedTags()
  // Cache key for page 1 of this feed+params (stale-while-revalidate).
  const cacheKey = `feed:${label}:${JSON.stringify(deps)}`
  const cacheKeyRef = useRef(cacheKey)
  cacheKeyRef.current = cacheKey
  // Seed from cache SYNCHRONOUSLY: the shell's scroll restore runs in a layout
  // effect on back/forward, and content that only appears in a passive effect
  // would clamp the restored offset to ~0 on every history navigation.
  const [contents, setContents] = useState<Content[]>(
    () => readCache<Content[]>(cacheKey) ?? []
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pageRef = useRef(0)
  const pagesRef = useRef(1)
  const seen = useRef<Set<string>>(new Set())
  const runId = useRef(0)
  // Guard concurrency via a ref (not the `loading` state) so it can't go stale
  // in closures or get stuck `true` when a run is superseded by a reset.
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
      if (myRun !== runId.current) return [] // superseded by a reset
      pageRef.current = r.page || next
      pagesRef.current = r.pages || pageRef.current
      // Dedupe by id, then drop items carrying a blocked tag so they never reach
      // the grid or the player. When no tags are blocked, `isBlocked` is a no-op.
      const fresh = (r.contents || [])
        .filter((c) => !seen.current.has(c.id))
        .filter((c) => !isBlocked(c))
      fresh.forEach((c) => seen.current.add(c.id))
      if (next === 1) {
        // Page 1 replaces the (possibly cached) snapshot and is persisted so the
        // next visit paints instantly instead of flashing empty.
        setContents(fresh)
        writeCache(cacheKeyRef.current, fresh)
      } else if (fresh.length) {
        setContents((prev) => [...prev, ...fresh])
      }
      return fresh
    } catch (e) {
      if (myRun === runId.current) setError((e as Error).message)
      return []
    } finally {
      if (myRun === runId.current) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }, [fetcher, isBlocked])

  // Always call the latest loadNext (fresh fetcher/order) from a stable reset.
  const loadNextRef = useRef(loadNext)
  loadNextRef.current = loadNext

  const reset = useCallback(() => {
    runId.current += 1
    pageRef.current = 0
    pagesRef.current = 1
    seen.current = new Set()
    loadingRef.current = false
    // Paint the cached page-1 immediately (no empty flash), then revalidate.
    setContents(readCache<Content[]>(cacheKeyRef.current) ?? [])
    setError(null)
    void loadNextRef.current()
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, deps)

  // Final safety net: hide blocked-tag items even if the block set loaded after
  // the pages were fetched, so they never reach the grid or the player.
  const visible = contents.filter((c) => !isBlocked(c))
  const hasMore = pageRef.current < pagesRef.current

  const openAt = useCallback(
    (_content: Content, index: number): void => {
      player.open({ items: visible, index, label, loadMore: loadNext, nicheId: opts?.nicheId })
    },
    [player, visible, label, loadNext, opts?.nicheId]
  )

  return { contents: visible, loading, error, hasMore, loadMore: () => void loadNext(), reload: reset, openAt }
}
