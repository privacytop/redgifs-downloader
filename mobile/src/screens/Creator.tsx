import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import { usePlayer } from '../player/PlayerProvider'
import MediaGrid from '../components/MediaGrid'
import { useToast } from '../context/toast'
import { useAuth } from '../context/auth'
import { FOLLOW_EVENT, isFollowing, loadFollows, setFollow, type FollowChange } from '../lib/follows'
import { formatCount } from '../lib/format'
import type { Content, UserProfile } from '@redloader/core'

const MAX_TAGS = 16
type Order = 'best' | 'latest' | 'top' | 'new'
const ORDERS: Order[] = ['best', 'latest', 'top', 'new']

/**
 * Creator: one creator's profile header (avatar, stats, follow, tags) over
 * their gif feed with an order filter. The same paginator drives the grid and
 * the swipe player.
 */
export default function Creator(): React.JSX.Element {
  const player = usePlayer()
  const navigate = useNavigate()
  const notify = useToast()
  const { authenticated } = useAuth()
  const { username: raw } = useParams<{ username: string }>()
  const username = decodeURIComponent(raw ?? '')

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [order, setOrder] = useState<Order>('best')
  const [following, setFollowing] = useState(() => isFollowing(username))
  const [followBusy, setFollowBusy] = useState(false)

  useEffect(() => {
    let live = true
    setProfile(null)
    setTags([])
    void api.getUser(username).then((p) => live && setProfile(p)).catch(() => undefined)
    void api.getCreatorTags(username).then((t) => live && setTags(t)).catch(() => undefined)
    return () => {
      live = false
    }
  }, [username])

  // Reflect the shared follows cache + live changes.
  useEffect(() => {
    setFollowing(isFollowing(username))
    void loadFollows().then(() => setFollowing(isFollowing(username)))
    const onChange = (e: Event): void => {
      const d = (e as CustomEvent<FollowChange>).detail
      if (d.username.toLowerCase() === username.toLowerCase()) setFollowing(d.following)
    }
    window.addEventListener(FOLLOW_EVENT, onChange)
    return () => window.removeEventListener(FOLLOW_EVENT, onChange)
  }, [username])

  const feed = usePagedFeed(
    (p) => api.getCreatorContent(username, { order, page: p }),
    [username, order],
    `creator:${username}:${order}`
  )

  const open = (_c: Content, index: number): void => {
    player.open({ items: feed.items, index, label: `@${username}`, loadMore: feed.loadMoreItems })
  }

  const follow = (): void => {
    if (followBusy) return
    setFollowBusy(true)
    const next = !following
    setFollow(username, next)
      .catch((e) =>
        notify(
          (authenticated ? 'Follow failed: ' : 'Sign in to follow — ') +
            (e instanceof Error ? e.message : String(e)),
          authenticated ? 'error' : 'info'
        )
      )
      .finally(() => setFollowBusy(false))
  }

  const initial = (profile?.name || username || '?').charAt(0).toUpperCase()

  return (
    <div className="page">
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
        <button className={`btn btn-sm ${following ? 'on' : ''}`} disabled={followBusy} onClick={follow}>
          {following ? 'Following' : 'Follow'}
        </button>
      </div>

      <div className="seg" role="group" aria-label="Sort" style={{ margin: '14px 0 4px' }}>
        {ORDERS.map((o) => (
          <button key={o} className={order === o ? 'on' : ''} onClick={() => setOrder(o)}>
            {o}
          </button>
        ))}
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
