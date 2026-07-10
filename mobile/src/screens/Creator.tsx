import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import Feed from '../components/Feed'
import ScreenHeader from '../components/ScreenHeader'
import { useToast } from '../context/toast'
import { useAuth } from '../context/auth'
import { FOLLOW_EVENT, isFollowing, loadFollows, setFollow, type FollowChange } from '../lib/follows'
import { formatCount } from '../lib/format'
import type { UserProfile } from '@redloader/core'

const MAX_TAGS = 16

/**
 * Creator: one creator's profile header (avatar, stats, follow, tags) over
 * their gif feed. A shared Feed component provides the grid, sort, and player.
 */
export default function Creator(): React.JSX.Element {
  const navigate = useNavigate()
  const notify = useToast()
  const { authenticated } = useAuth()
  const { username: raw } = useParams<{ username: string }>()
  const username = decodeURIComponent(raw ?? '')

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [tags, setTags] = useState<string[]>([])
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
    (p) => api.getCreatorContent(username, { order: 'best', page: p }),
    [username],
    `creator:${username}`
  )

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
      <ScreenHeader title={`@${username}`} back />

      <div className="creator" style={{ marginTop: 4 }}>
        <div className="avatar">
          {profile?.profilePic ? <img src={profile.profilePic} alt="" /> : initial}
        </div>
        <div className="creator-info">
          <div className="creator-name">@{username}</div>
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

      <Feed feed={feed} label={`@${username}`} emptyMessage="No gifs yet" />
    </div>
  )
}
