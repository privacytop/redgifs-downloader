import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from '../nav'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import Feed from '../components/Feed'
import ScreenHeader from '../components/ScreenHeader'
import SortMenu from '../components/SortMenu'
import { useToast } from '../context/toast'
import { useAuth } from '../context/auth'
import { FOLLOW_EVENT, isFollowing, loadFollows, setFollow, type FollowChange } from '../lib/follows'
import { formatCount } from '../lib/format'
import { CREATOR_SORTS, findSort } from '../lib/sort'
import type { UserProfile } from '@redloader/core'
import { CachedImage } from '../components/CachedMedia'
import { IconX } from '../components/icons'

const COLLAPSED_TAGS = 10
type TagCount = { name: string; count: number }

/**
 * Creator: profile header (avatar, stats, follow) over their gif feed. The
 * creator's tags are FILTER chips — tap one (or several: AND) to narrow the
 * feed server-side via `tags=`; the sort is a real server order
 * (/users/{u}/search: newest, oldest, trending, top week/month/all).
 */
export default function Creator(): React.JSX.Element {
  const notify = useToast()
  const { authenticated } = useAuth()
  const { username = '' } = useParams<{ username: string }>()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [tags, setTags] = useState<TagCount[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const [sort, setSort] = useState('latest')
  const [following, setFollowing] = useState(() => isFollowing(username))
  const followBusy = useRef(false)

  useEffect(() => {
    let live = true
    setProfile(null)
    setTags([])
    setSelected([])
    void api.getUser(username).then((p) => live && setProfile(p)).catch(() => undefined)
    void api.getCreatorTagCounts(username).then((t) => live && setTags(t)).catch(() => undefined)
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

  const order = findSort(CREATOR_SORTS, sort).order ?? 'latest'
  const tagParam = selected.join(' ')
  const feed = usePagedFeed(
    (p) => api.getCreatorContent(username, { order, page: p, tags: tagParam || undefined }),
    [username, order, tagParam],
    `creator:${username}:${order}:${tagParam}`
  )

  // setFollow is optimistic (flips + broadcasts, reverts on error), so the
  // button is never disabled — it only ignores re-taps while a call is in flight.
  const follow = (): void => {
    if (followBusy.current) return
    followBusy.current = true
    const next = !following
    setFollow(username, next)
      .catch((e) =>
        notify(
          (authenticated ? 'Follow failed: ' : 'Sign in to follow — ') +
            (e instanceof Error ? e.message : String(e)),
          authenticated ? 'error' : 'info'
        )
      )
      .finally(() => {
        followBusy.current = false
      })
  }

  const toggleTag = (name: string): void => {
    setSelected((cur) => (cur.includes(name) ? cur.filter((t) => t !== name) : [...cur, name]))
  }

  // Selected tags float to the front so they stay visible when collapsed.
  const shownTags = useMemo(() => {
    const sel = tags.filter((t) => selected.includes(t.name))
    const rest = tags.filter((t) => !selected.includes(t.name))
    const all = [...sel, ...rest]
    return expanded ? all : all.slice(0, Math.max(COLLAPSED_TAGS, sel.length))
  }, [tags, selected, expanded])
  const hiddenCount = tags.length - shownTags.length

  const initial = (profile?.name || username || '?').charAt(0).toUpperCase()

  return (
    <div className="page">
      <ScreenHeader title={`@${username}`} back />

      <div className="creator" style={{ marginTop: 4 }}>
        <div className="avatar">
          {profile?.profilePic ? (
            <CachedImage cacheKey={`creator:${username}`} src={profile.profilePic} alt="" />
          ) : initial}
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
        <button className={`btn btn-sm ${following ? 'on' : ''}`} aria-pressed={following} onClick={follow}>
          {following ? 'Following' : 'Follow'}
        </button>
      </div>

      {tags.length > 0 && (
        <div className="chip-row" style={{ margin: '14px 0 4px' }}>
          {shownTags.map((t) => {
            const on = selected.includes(t.name)
            return (
              <button
                key={t.name}
                className={`chip chip-count ${on ? 'on' : ''}`}
                aria-pressed={on}
                onClick={() => toggleTag(t.name)}
              >
                {t.name}
                {t.count > 0 && <span className="chip-n">{formatCount(t.count)}</span>}
              </button>
            )
          })}
          {hiddenCount > 0 && (
            <button className="chip chip-more" onClick={() => setExpanded(true)}>
              +{hiddenCount} more
            </button>
          )}
          {expanded && tags.length > COLLAPSED_TAGS && (
            <button className="chip chip-more" onClick={() => setExpanded(false)}>
              Less
            </button>
          )}
          {selected.length > 0 && (
            <button className="chip chip-clear" onClick={() => setSelected([])} aria-label="Clear tag filters">
              <IconX /> Clear
            </button>
          )}
        </div>
      )}

      <div className="feed-head" style={{ margin: '16px 0 10px' }}>
        <span className="readout">
          {feed.total ? `${formatCount(feed.total)} gifs` : ''}
          {selected.length > 0 ? ` · ${selected.length} tag${selected.length > 1 ? 's' : ''}` : ''}
        </span>
        <SortMenu options={CREATOR_SORTS} value={sort} onChange={setSort} />
      </div>

      <Feed
        feed={feed}
        label={`@${username}`}
        emptyMessage={selected.length ? 'No gifs with these tags' : 'No gifs yet'}
        emptyHint={selected.length ? 'Tags combine with AND — deselect one.' : undefined}
        sorts={CREATOR_SORTS}
        sort={sort}
        onSortChange={setSort}
        hideToolbar
      />
    </div>
  )
}
