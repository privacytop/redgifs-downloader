import { useEffect, useState } from 'react'
import { formatCount } from '../lib/format'
import { FOLLOW_EVENT, FOLLOWS_RELOADED_EVENT, isFollowing, loadFollows, setFollow } from '../lib/follows'
import type { FollowChange } from '../lib/follows'
import { useAuthed } from '../hooks/useAuthed'
import { useNotify } from '../context/notify'
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
 * Shows a Following state from the shared follows cache, with a hover-revealed
 * follow/unfollow button (kept visible while following, as the indicator).
 */
export default function CreatorCard({ user, onOpen, sub }: CreatorCardProps): JSX.Element {
  const authed = useAuthed()
  const notify = useNotify()
  const [following, setFollowing] = useState(() => isFollowing(user.username))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void loadFollows().then(() => {
      if (alive) setFollowing(isFollowing(user.username))
    })
    const onChange = (e: Event): void => {
      const d = (e as CustomEvent<FollowChange>).detail
      if (d.username.toLowerCase() === user.username.toLowerCase()) setFollowing(d.following)
    }
    const onReloaded = (): void => setFollowing(isFollowing(user.username))
    window.addEventListener(FOLLOW_EVENT, onChange)
    window.addEventListener(FOLLOWS_RELOADED_EVENT, onReloaded)
    return () => {
      alive = false
      window.removeEventListener(FOLLOW_EVENT, onChange)
      window.removeEventListener(FOLLOWS_RELOADED_EVENT, onReloaded)
    }
  }, [user.username])

  const toggle = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    const next = !following
    try {
      await setFollow(user.username, next)
    } catch (e) {
      notify((next ? 'Follow' : 'Unfollow') + ' failed: ' + (e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="creator-card">
      <button
        type="button"
        className="card-open"
        aria-label={`View @${user.username}`}
        title={`View @${user.username}`}
        onClick={() => onOpen(user.username)}
      />
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
      {authed === true && (
        <button
          type="button"
          className={`btn btn-sm creator-follow ${following ? 'on' : ''}`}
          aria-pressed={following}
          disabled={busy}
          title={following ? `Unfollow @${user.username}` : `Follow @${user.username}`}
          onClick={() => void toggle()}
        >
          {following ? 'Following' : 'Follow'}
        </button>
      )}
    </div>
  )
}
