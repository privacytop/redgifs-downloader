import type { Content } from '@shared/types'
import type { ViewMode } from './ViewToggle'
import MediaCard from './MediaCard'

interface FeedGridProps {
  items: Content[]
  mode: ViewMode
  onOpen: (content: Content, index: number) => void
  onDownload: (content: Content) => void
}

/**
 * Renders a list of `Content` as a responsive portrait grid.
 * - `grid`/`feed`: uniform `.media-grid` of `MediaCard`s.
 * - `editorial`: first item spans larger (2 cols / taller) via `.feed-editorial`,
 *   every tile carries a zero-padded rank badge (`01`, `02`, …).
 */
export default function FeedGrid({ items, mode, onOpen, onDownload }: FeedGridProps): JSX.Element {
  if (mode === 'editorial') {
    return (
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
    )
  }

  return (
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
  )
}
