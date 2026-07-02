import { useEffect, useRef } from 'react'
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
}

/**
 * Renders a list of `Content` in one of three visually distinct layouts:
 * - `grid`: dense responsive portrait grid of `MediaCard`s.
 * - `editorial`: asymmetric magazine layout — the first item is a large 2×2
 *   hero with rank `01`; the rest flow in the responsive grid with `02`, `03`…
 * - `feed`: a single centered column of large portrait items, one per row.
 *
 * Optional infinite scroll: pass `onEndReached` + `hasMore` (+ `loading`).
 */
export default function FeedGrid({
  items,
  mode,
  onOpen,
  onDownload,
  onEndReached,
  hasMore,
  loading
}: FeedGridProps): JSX.Element {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const infinite = Boolean(onEndReached)

  // Keep the latest callback/flags without re-creating the observer each render.
  const cbRef = useRef<{ onEndReached?: () => void; hasMore?: boolean; loading?: boolean }>({})
  cbRef.current = { onEndReached, hasMore, loading }

  useEffect(() => {
    if (!infinite) return
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        const { onEndReached, hasMore, loading } = cbRef.current
        if (entries[0]?.isIntersecting && hasMore && !loading) onEndReached?.()
      },
      { rootMargin: '600px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [infinite])

  const sentinel = infinite ? (
    <>
      {loading && <div className="feed-loading">Loading…</div>}
      {hasMore && <div ref={sentinelRef} className="feed-sentinel" aria-hidden="true" />}
    </>
  ) : null

  if (mode === 'editorial') {
    return (
      <>
        <div className="feed-grid feed-editorial">
          {items.map((c, i) => (
            <div key={c.id} className={i === 0 ? 'feed-hero' : undefined}>
              <MediaCard
                content={c}
                badge={String(i + 1).padStart(2, '0')}
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
