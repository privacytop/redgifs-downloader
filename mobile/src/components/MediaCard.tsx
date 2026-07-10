import { useNavigate } from 'react-router-dom'
import type { Content } from '@redloader/core'
import { formatViews } from '../lib/format'

interface MediaCardProps {
  content: Content
  onOpen: (content: Content) => void
  badge?: string
}

/** Portrait 9:16 tile: poster + creator + views. Tap opens the player. */
export default function MediaCard({ content, onOpen, badge }: MediaCardProps): React.JSX.Element {
  const navigate = useNavigate()
  const poster = content.urls.thumbnail || content.urls.poster

  return (
    <div className="card">
      {poster && <img className="card-img" src={poster} alt="" loading="lazy" />}
      <div className="card-scrim" />
      {badge && <span className="card-badge">{badge}</span>}
      <button
        className="card-open"
        aria-label={`Play @${content.username}`}
        onClick={() => onOpen(content)}
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
}
