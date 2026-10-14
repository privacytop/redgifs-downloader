import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Content, ContentResponse } from '@redloader/core'
import { readCache, writeCache } from '../lib/cache'
import { LruCache } from '../lib/lru'
import { isBlocked, useBlockedVersion } from '../lib/blockedTags'

interface FeedSnapshot {
  items: Content[]
  page: number
  pages: number
  total: number | null
}

// Screens now stay mounted (keep-alive tab stacks), but a pushed screen that is
// popped and re-opened (same creator, same tag…) still benefits from the exact
// pages it had, instead of a freshly randomised page 1.
const sessionFeeds = new LruCache<string, FeedSnapshot>(20)

// Hard cap for `drain()`: 40 pages × 80 = 3,200 items — enough for a true
// global client-side sort of any realistic collection/likes list without
// hammering the API forever on a 10,000-item feed.
export const DRAIN_MAX_PAGES = 40

export interface PagedFeed {
  items: Content[]
  loading: boolean
  error: string | null
  hasMore: boolean
  /** Server-reported total, when the endpoint gives one. */
  total: number | null
  /** Pages fetched so far / pages the server reports. */
  page: number
  pages: number
  loadMore: () => void
  reload: () => void
  /** Returns the next page's fresh items — handed to the player to keep paging. */
  loadMoreItems: () => Promise<Content[]>
  /**
   * Fetch every remaining page (capped at DRAIN_MAX_PAGES) so a client-side
   * sort covers the whole feed, not just what happened to be loaded.
   */
  drain: () => Promise<void>
  draining: boolean
}

/**
 * One paginator driving both the grid and the swipe player. Fetches pages via
 * `fetcher`, dedupes by id, drops blocked-tag items, and resets when `deps`
 * change. With a `cacheKey`, page 1 is persisted and painted instantly on the
 * next visit (stale-while-revalidate) so switching never flashes empty.
 */
export function usePagedFeed(
  fetcher: (page: number) => Promise<ContentResponse>,
  deps: unknown[] = [],
  cacheKey?: string
): PagedFeed {
  const cacheKeyRef = useRef(cacheKey)
  cacheKeyRef.current = cacheKey

  const initialSnapshot = cacheKey ? sessionFeeds.get(cacheKey) : undefined

  const [rawItems, setItems] = useState<Content[]>(() =>
    initialSnapshot?.items ?? (cacheKey ? (readCache<Content[]>(cacheKey) ?? []) : [])
  )
  const [loading, setLoading] = useState(false)
  const [draining, setDraining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Mirrored into state so `hasMore` re-renders when paging advances.
  const [paging, setPaging] = useState<{ page: number; pages: number; total: number | null }>({
    page: initialSnapshot?.page ?? 0,
    pages: initialSnapshot?.pages ?? 1,
    total: initialSnapshot?.total ?? null
  })
  const pageRef = useRef(paging.page)
  const pagesRef = useRef(paging.pages)
  const totalRef = useRef<number | null>(paging.total)
  const seen = useRef<Set<string>>(new Set(initialSnapshot?.items.map((c) => c.id) ?? []))
  const runId = useRef(0)
  const loadingRef = useRef(false)
  const inflight = useRef<Promise<Content[]> | null>(null)
  const drainingRef = useRef(false)

  const syncPaging = (): void => {
    setPaging({ page: pageRef.current, pages: pagesRef.current, total: totalRef.current })
  }

  const loadNext = useCallback((): Promise<Content[]> => {
    // A second caller (the player prefetching while the grid sentinel is
    // already loading) must get THAT page's items, not [] — otherwise the
    // player silently skips a whole page.
    if (loadingRef.current && inflight.current) return inflight.current
    if (pageRef.current > 0 && pageRef.current >= pagesRef.current) return Promise.resolve([])
    const p = loadPage()
    inflight.current = p
    return p
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const loadPage = async (): Promise<Content[]> => {
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
      if (typeof r.total === 'number' && r.total > 0) totalRef.current = r.total
      const fresh = (r.contents || []).filter((c) => !seen.current.has(c.id) && !isBlocked(c))
      fresh.forEach((c) => seen.current.add(c.id))
      const key = cacheKeyRef.current
      if (next === 1) {
        setItems(fresh)
        // An empty page 1 (gated feed, transient empty result) must not be
        // remembered as "this feed is empty" for the rest of the session.
        if (key && fresh.length) {
          writeCache(key, fresh.slice(0, 80))
          sessionFeeds.set(key, { items: fresh, page: pageRef.current, pages: pagesRef.current, total: totalRef.current })
        }
      } else if (fresh.length) {
        setItems((prev) => {
          const merged = [...prev, ...fresh]
          if (key) sessionFeeds.set(key, { items: merged, page: pageRef.current, pages: pagesRef.current, total: totalRef.current })
          return merged
        })
      }
      syncPaging()
      return fresh
    } catch (e) {
      if (myRun === runId.current) setError(e instanceof Error ? e.message : String(e))
      return []
    } finally {
      if (myRun === runId.current) {
        loadingRef.current = false
        inflight.current = null
        setLoading(false)
      }
    }
  }

  const loadNextRef = useRef(loadNext)
  loadNextRef.current = loadNext

  const resetRefs = (): void => {
    runId.current += 1
    pageRef.current = 0
    pagesRef.current = 1
    totalRef.current = null
    seen.current = new Set()
    loadingRef.current = false
    inflight.current = null
    drainingRef.current = false
    setDraining(false)
  }

  const reset = useCallback(() => {
    resetRefs()
    const key = cacheKeyRef.current
    if (key) sessionFeeds.delete(key)
    // Paint the cached page-1 immediately (no empty flash), then revalidate.
    setItems(key ? (readCache<Content[]>(key) ?? []) : [])
    setError(null)
    syncPaging()
    void loadNextRef.current()
  }, [])

  const activate = useCallback(() => {
    const key = cacheKeyRef.current
    const snapshot = key ? sessionFeeds.get(key) : undefined
    runId.current += 1
    loadingRef.current = false
    inflight.current = null
    drainingRef.current = false
    setDraining(false)
    if (snapshot) {
      pageRef.current = snapshot.page
      pagesRef.current = snapshot.pages
      totalRef.current = snapshot.total
      seen.current = new Set(snapshot.items.map((c) => c.id))
      setItems(snapshot.items)
      setError(null)
      setLoading(false)
      syncPaging()
      return
    }
    resetRefs()
    setItems(key ? (readCache<Content[]>(key) ?? []) : [])
    setError(null)
    syncPaging()
    void loadNextRef.current()
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(activate, deps)

  const drain = useCallback(async (): Promise<void> => {
    if (drainingRef.current) return
    const myRun = runId.current
    drainingRef.current = true
    setDraining(true)
    try {
      let pagesThisDrain = 0
      while (
        myRun === runId.current &&
        pagesThisDrain < DRAIN_MAX_PAGES &&
        (pageRef.current === 0 || pageRef.current < pagesRef.current)
      ) {
        // Another caller (grid sentinel) may be mid-page; wait for it rather than
        // skipping, so the loop can't exit early on a transient `loading`.
        if (loadingRef.current) {
          await new Promise((r) => setTimeout(r, 60))
          continue
        }
        const before = pageRef.current
        await loadNextRef.current()
        if (pageRef.current === before) break // error or superseded
        pagesThisDrain++
      }
    } finally {
      if (myRun === runId.current) {
        drainingRef.current = false
        setDraining(false)
      }
    }
  }, [])

  // Blocked tags can load/change after pages were fetched — filter again here
  // so nothing blocked ever reaches the grid or the player.
  const blockedVersion = useBlockedVersion()
  const items = useMemo(() => {
    void blockedVersion
    const out = rawItems.filter((c) => !isBlocked(c))
    return out.length === rawItems.length ? rawItems : out
  }, [rawItems, blockedVersion])

  const loadMore = useCallback((): void => void loadNext(), [loadNext])

  return useMemo<PagedFeed>(
    () => ({
      items,
      loading,
      error,
      hasMore: paging.page < paging.pages,
      total: paging.total,
      page: paging.page,
      pages: paging.pages,
      loadMore,
      reload: reset,
      loadMoreItems: loadNext,
      drain,
      draining
    }),
    [items, loading, error, paging, loadMore, reset, loadNext, drain, draining]
  )
}

/** Forget every in-memory feed snapshot (sign-out / account switch). */
export function clearSessionFeeds(): void {
  sessionFeeds.clear()
}
