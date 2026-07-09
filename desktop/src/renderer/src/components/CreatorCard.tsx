import { formatCount } from '../lib/format'
import type { UserResult } from '@shared/types'

interface CreatorCardProps {
  user: UserResult
  onOpen: (username: string) => void
  /** Meta line under the name — defaults to `{followers} followers · {gifs} gifs`. */
  sub?: string
}

/**
 * A single creator result: avatar + @name + meta line, click → creator page.
 * The one card Search and Following both render, so the two never drift again.
 */
export default function CreatorCard({ user, onOpen, sub }: CreatorCardProps): JSX.Element {
  return (
    <button
      type="button"
      className="creator-card"
      onClick={() => onOpen(user.username)}
      title={`View @${user.username}`}
    >
      <div className="creator-avatar" aria-hidden="true">
        {user.profileImageUrl ? (
          <img src={user.profileImageUrl} alt="" loading="lazy" />
        ) : (
          <span>{(user.name || user.username || '?').trim().charAt(0).toUpperCase() || '?'}</span>
        )}
      </div>
      <div className="creator-info">
        <div className="creator-name">@{user.username}</div>
        <div className="creator-sub">
          {sub ?? `${formatCount(user.followers)} followers · ${formatCount(user.gifs)} gifs`}
        </div>
      </div>
    </button>
  )
}
