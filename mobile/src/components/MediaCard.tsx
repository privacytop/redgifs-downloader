import { memo } from 'react'
import type { Content } from '@redloader/core'
import { useNavigate } from '../nav'
import { formatViews } from '../lib/format'
import { CachedImage } from './CachedMedia'

interface MediaCardProps {
  content: Content
  index: number
  onOpen: (content: Content, index: number) => void
  badge?: string
}

/**
 * Portrait 9:16 tile: poster + creator + views. Tap opens the player.
 * Memoised: a feed's loading/paging state changes must not re-render every
 * tile, so the parent passes a stable `onOpen` and the index.
 */
const MediaCard = memo(function MediaCard({ content, index, onOpen, badge }: MediaCardProps): React.JSX.Element {
  const navigate = useNavigate()
  const poster = content.urls.thumbnail || content.urls.poster

  return (
    <div className="card">
      {poster && (
        <CachedImage
          cacheKey={`media:${content.id}`}
          className="card-img"
          src={poster}
          alt=""
          loading="lazy"
          decoding="async"
        />
      )}
      <div className="card-scrim" />
      {badge && <span className="card-badge">{badge}</span>}
      <button
        className="card-open"
        aria-label={`Play @${content.username}`}
        onClick={() => onOpen(content, index)}
      />
      <div className="card-meta">
        <button
          className="card-user"
          style={{ pointerEvents: 'auto', border: 0, background: 'none', padding: 0 }}
          onClick={(e) => {
            e.stopPropagation()
            navigate(`/creator/${encodeURIComponent(content.username)}`)
          }}
        >
          @{content.username}
        </button>
        <span className="card-views">{formatViews(content.views)}</span>
      </div>
    </div>
  )
})

export default MediaCard
