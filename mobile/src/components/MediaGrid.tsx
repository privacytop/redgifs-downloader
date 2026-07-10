import { useEffect, useState } from 'react'
import type { Content } from '@redloader/core'
import MediaCard from './MediaCard'

interface MediaGridProps {
  items: Content[]
  onOpen: (content: Content, index: number) => void
  onEndReached?: () => void
  hasMore?: boolean
  loading?: boolean
}

/** 2-column portrait grid with infinite scroll via a sentinel. */
export default function MediaGrid({
  items,
  onOpen,
  onEndReached,
  hasMore,
  loading
}: MediaGridProps): React.JSX.Element {
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!sentinel || !onEndReached) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading) onEndReached()
      },
      { rootMargin: '800px 0px' }
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [sentinel, onEndReached, hasMore, loading])

  return (
    <>
      <div className="grid">
        {items.map((c, i) => (
          <MediaCard key={c.id} content={c} onOpen={(x) => onOpen(x, i)} />
        ))}
      </div>
      {loading && <div className="loading">Loading…</div>}
      {onEndReached && hasMore && !loading && (
        <div ref={setSentinel} style={{ height: 1 }} aria-hidden="true" />
      )}
    </>
  )
}
