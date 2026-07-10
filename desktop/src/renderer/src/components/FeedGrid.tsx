import { useEffect, useRef, useState } from 'react'
import type { Content } from '@shared/types'
import type { ViewMode } from './ViewToggle'
import MediaCard from './MediaCard'

interface FeedGridProps {
  items: Content[]
  mode: ViewMode
  onOpen: (content: Content, index: number) => void
  onDownload: (content: Content) => void
  /**
   * Optional infinite scroll. When both `onEndReached` and `hasMore` are
   * provided, a sentinel is rendered after the items; an IntersectionObserver
   * calls `onEndReached()` as it scrolls into view (skipped while `loading`).
   */
  onEndReached?: () => void
  hasMore?: boolean
  loading?: boolean
  /**
   * Mid-feed fetch failure (with content already on screen). Renders an inline
   * error row with a Retry button under the grid — without it a failed
   * `loadMore` is invisible and the feed just silently stops.
   */
  error?: string | null
  onRetry?: () => void
}

/**
 * Editorial "slot" for an item at index `i`: every cycle of six items opens
 * with a 2×2 hero — left on even cycles, right on odd — flanked by two
 * stacked singles, then a row of three. Feed order is preserved (no dense
 * backfill). A hero only forms when at least two more items exist to fill the
 * rows beside it; a trailing remainder renders as plain tiles so the last
 * spread never collapses. Only heroes carry a plate number.
 */
function editorialSlot(i: number, total: number, hasMore: boolean): { cls?: string; featured: boolean } {
  // A hero needs two flanking items. `hasMore` counts as eligibility so a tile
  // that will gain flanks on the next page renders as a hero from the start —
  // otherwise pagination would morph it mid-view and reflow the grid.
  if (i % 6 === 0 && (i + 2 < total || hasMore)) {
    const heroRight = Math.floor(i / 6) % 2 === 1
    return { cls: heroRight ? 'ed-hero-r' : 'ed-hero-l', featured: true }
  }
  return { featured: false }
}

/**
 * Renders a list of `Content` in one of three visually distinct layouts:
 * - `grid`: dense responsive portrait grid of `MediaCard`s.
 * - `editorial`: a deterministic magazine layout — repeating six-item spreads
 *   with an alternating 2×2 hero; chronological order is preserved.
 * - `feed`: a single centered column of large portrait items, one per row.
 *
 * Optional infinite scroll: pass `onEndReached` + `hasMore` (+ `loading`,
 * `error`, `onRetry` for the mid-feed failure affordance).
 */
export default function FeedGrid({
  items,
  mode,
  onOpen,
  onDownload,
  onEndReached,
  hasMore,
  loading,
  error,
  onRetry
}: FeedGridProps): JSX.Element {
  const infinite = Boolean(onEndReached)

  // Keep the latest callback/flags without re-creating the observer each render.
  const cbRef = useRef<{ onEndReached?: () => void; hasMore?: boolean; loading?: boolean }>({})
  cbRef.current = { onEndReached, hasMore, loading }

  // The sentinel element lives in STATE (not a ref): the observer effect keys
  // on it, so it re-runs whenever the sentinel mounts/unmounts (retry after a
  // mid-feed error swaps the node) AND survives StrictMode's dev double-invoke
  // — setup and cleanup are symmetric, unlike a ref-callback-created observer,
  // which the doubled cleanup disconnected forever (infinite scroll silently
  // stopped after the first window on every page in `npm run dev`).
  const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!sentinelEl) return
    const io = new IntersectionObserver(
      (entries) => {
        const { onEndReached, hasMore, loading } = cbRef.current
        if (entries[0]?.isIntersecting && hasMore && !loading) onEndReached?.()
      },
      { rootMargin: '600px 0px' }
    )
    io.observe(sentinelEl)
    return () => io.disconnect()
  }, [sentinelEl])

  const failed = Boolean(error) && items.length > 0 && !loading
  const sentinel = infinite ? (
    <>
      {loading && <div className="feed-loading">Loading…</div>}
      {failed && (
        <div className="feed-error" role="alert">
          <span>Couldn’t load more — {error}</span>
          {onRetry && (
            <button type="button" className="btn btn-sm" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      )}
      {hasMore && !failed && <div ref={setSentinelEl} className="feed-sentinel" aria-hidden="true" />}
    </>
  ) : null

  if (mode === 'editorial') {
    return (
      <>
        <div className="feed-ed">
          {items.map((c, i) => {
            const { cls, featured } = editorialSlot(i, items.length, Boolean(hasMore))
            return (
              <div key={c.id} className={cls}>
                <MediaCard
                  content={c}
                  badge={featured ? String(i + 1).padStart(2, '0') : undefined}
                  onOpen={(x) => onOpen(x, i)}
                  onDownload={onDownload}
                />
              </div>
            )
          })}
        </div>
        {sentinel}
      </>
    )
  }

  if (mode === 'feed') {
    return (
      <>
        <div className="feed-column">
          {items.map((c, i) => (
            <div className="feed-column-item" key={c.id}>
              <MediaCard
                content={c}
                onOpen={(x) => onOpen(x, i)}
                onDownload={onDownload}
              />
            </div>
          ))}
        </div>
        {sentinel}
      </>
    )
  }

  return (
    <>
      <div className="feed-grid media-grid">
        {items.map((c, i) => (
          <MediaCard
            key={c.id}
            content={c}
            onOpen={(x) => onOpen(x, i)}
            onDownload={onDownload}
          />
        ))}
      </div>
      {sentinel}
    </>
  )
}
