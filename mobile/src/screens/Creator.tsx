import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import { usePlayer } from '../player/PlayerProvider'
import MediaGrid from '../components/MediaGrid'
import { useToast } from '../context/toast'
import { formatCount } from '../lib/format'
import type { Content, UserProfile } from '@redloader/core'

const MAX_TAGS = 16

/**
 * Creator: one creator's profile header (avatar, stats, tags) over their gif
 * feed. The same paginator drives the grid and the swipe player. Follow is a
 * stub until sign-in lands (phase 3).
 */
export default function Creator(): React.JSX.Element {
  const player = usePlayer()
  const navigate = useNavigate()
  const notify = useToast()
  const { username: raw } = useParams<{ username: string }>()
  const username = decodeURIComponent(raw ?? '')

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [tags, setTags] = useState<string[]>([])

  useEffect(() => {
    let live = true
    setProfile(null)
    setTags([])
    void api
      .getUser(username)
      .then((p) => {
        if (live) setProfile(p)
      })
      .catch(() => {
        /* header is best-effort; the feed still renders */
      })
    void api
      .getCreatorTags(username)
      .then((t) => {
        if (live) setTags(t)
      })
      .catch(() => {
        /* tags are optional chrome */
      })
    return () => {
      live = false
    }
  }, [username])

  const feed = usePagedFeed((p) => api.getCreatorContent(username, { order: 'best', page: p }), [username])

  const open = (_c: Content, index: number): void => {
    player.open({ items: feed.items, index, label: `@${username}`, loadMore: feed.loadMoreItems })
  }

  const follow = (): void => {
    // TODO(phase 3): real follow/unfollow once sign-in exists.
    notify('Sign in to follow', 'info')
  }

  const initial = (profile?.name || username || '?').charAt(0).toUpperCase()

  return (
    <div className="page">
      <div className="kicker">Creator</div>

      <div className="creator" style={{ marginTop: 4 }}>
        <div className="avatar">
          {profile?.profilePic ? <img src={profile.profilePic} alt="" /> : initial}
        </div>
        <div className="creator-info">
          <h1 className="title" style={{ margin: 0, fontSize: 22 }}>@{username}</h1>
          {profile && (
            <div className="readout" style={{ marginTop: 4 }}>
              {formatCount(profile.followers)} followers · {formatCount(profile.totalGifs)} gifs ·{' '}
              {formatCount(profile.views)} views
            </div>
          )}
        </div>
        <button className="btn btn-sm" onClick={follow}>Follow</button>
      </div>

      {tags.length > 0 && (
        <div className="chip-row" style={{ margin: '14px 0 4px' }}>
          {tags.slice(0, MAX_TAGS).map((t) => (
            <button
              key={t}
              className="chip"
              onClick={() => navigate(`/tag/${encodeURIComponent(t)}`)}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <hr className="rule" />

      {feed.error && feed.items.length === 0 ? (
        <div className="empty">
          <div className="empty-msg">Couldn’t load</div>
          <div className="empty-sub">{feed.error}</div>
          <button className="btn" onClick={feed.reload}>Try again</button>
        </div>
      ) : !feed.loading && feed.items.length === 0 ? (
        <div className="empty">
          <div className="empty-msg">No gifs yet</div>
          <div className="empty-sub">@{username} hasn’t posted anything we can show right now.</div>
        </div>
      ) : (
        <MediaGrid
          items={feed.items}
          onOpen={open}
          onEndReached={feed.loadMore}
          hasMore={feed.hasMore}
          loading={feed.loading}
        />
      )}
    </div>
  )
}
