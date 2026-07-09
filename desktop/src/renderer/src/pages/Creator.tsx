import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import FeedControls from '../components/FeedControls'
import FeedState from '../components/FeedState'
import FeedGrid from '../components/FeedGrid'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useDownload } from '../hooks/useDownload'
import { useViewMode } from '../hooks/useViewMode'
import { useNotify } from '../context/notify'
import { useQuality } from '../context/quality'
import { useNav } from '../context/nav'
import { useAuthed } from '../hooks/useAuthed'
import { formatCount } from '../lib/format'
import { FOLLOW_EVENT, FOLLOWS_RELOADED_EVENT, isFollowing, loadFollows, setFollow } from '../lib/follows'
import type { FollowChange } from '../lib/follows'
import { DEFAULT_ORDER, typeNoun, type ContentType, type Order } from '../lib/feedOptions'
import type { UserProfile } from '@shared/types'

const TAG_CAP = 24

/** Creator profile page: header + tag chips + type/order/view controls + feed. */
export default function Creator({ username }: { username: string }): JSX.Element {
  const notify = useNotify()
  const { navigate } = useNav()
  const { quality } = useQuality()
  const download = useDownload()
  const [mode, setMode] = useViewMode('creator', 'grid')
  const [type, setType] = useState<ContentType>('g')
  const [order, setOrder] = useState<Order>(DEFAULT_ORDER)

  const authed = useAuthed()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [showAllTags, setShowAllTags] = useState(false)
  const [following, setFollowing] = useState(() => isFollowing(username))
  const [followBusy, setFollowBusy] = useState(false)
  // "Download all" lifecycle: disabled from click until the queue call lands,
  // and kept disabled once queued so a re-click can't queue the catalog twice.
  const [queueState, setQueueState] = useState<'idle' | 'queuing' | 'queued'>('idle')

  useEffect(() => {
    let alive = true
    setQueueState('idle') // new creator, new catalog — re-arm "Download all"
    window.api
      .getUser(username)
      .then((p) => {
        if (alive) setProfile(p)
      })
      .catch(() => {
        /* header degrades gracefully to just the @username title */
      })
    window.api
      .getCreatorTags(username)
      .then((t) => {
        if (alive) setTags(Array.isArray(t) ? t : [])
      })
      .catch(() => {
        if (alive) setTags([])
      })
    return () => {
      alive = false
    }
  }, [username])

  // Reflect the shared follows cache, including changes made in the player or
  // on creator cards while this page is open.
  useEffect(() => {
    let alive = true
    setFollowing(isFollowing(username))
    void loadFollows().then(() => {
      if (alive) setFollowing(isFollowing(username))
    })
    const onChange = (e: Event): void => {
      const d = (e as CustomEvent<FollowChange>).detail
      if (d.username.toLowerCase() === username.toLowerCase()) setFollowing(d.following)
    }
    const onReloaded = (): void => setFollowing(isFollowing(username))
    window.addEventListener(FOLLOW_EVENT, onChange)
    window.addEventListener(FOLLOWS_RELOADED_EVENT, onReloaded)
    return () => {
      alive = false
      window.removeEventListener(FOLLOW_EVENT, onChange)
      window.removeEventListener(FOLLOWS_RELOADED_EVENT, onReloaded)
    }
  }, [username])

  const toggleFollow = (): void => {
    if (followBusy) return
    setFollowBusy(true)
    const next = !following
    setFollow(username, next)
      .catch((e) =>
        notify((next ? 'Follow' : 'Unfollow') + ' failed: ' + (e as Error).message, 'error')
      )
      .finally(() => setFollowBusy(false))
  }

  const feed = usePlayableFeed(
    (p) => window.api.getCreatorContent(username, { type, order, page: p }),
    '@' + username,
    [username, type, order]
  )

  const downloadAll = (): void => {
    setQueueState('queuing')
    window.api
      .startDownload({ type: 'user', username, quality })
      .then(() => {
        setQueueState('queued')
        notify('Queued @' + username + ' — downloading all', 'success')
      })
      .catch((e) => {
        setQueueState('idle') // nothing was queued — let the user try again
        notify('Download failed: ' + (e as Error).message, 'error')
      })
  }

  const controls = (
    <div className="controls">
      <FeedControls
        mode={mode}
        onModeChange={setMode}
        order={order}
        onOrderChange={setOrder}
        type={type}
        onTypeChange={setType}
      />
      <button
        type="button"
        className="btn btn-ember btn-sm"
        onClick={downloadAll}
        disabled={queueState !== 'idle'}
        title="Downloads the full catalog — ignores the filters above"
      >
        {queueState === 'queuing' ? 'Queuing…' : queueState === 'queued' ? 'Queued' : 'Download all'}
      </button>
    </div>
  )

  const stat = (value: number, label: string): JSX.Element => (
    <span className="stat">
      <span className="stat-n">{formatCount(value)}</span>
      <span className="stat-l">{label}</span>
    </span>
  )

  const visibleTags = showAllTags ? tags : tags.slice(0, TAG_CAP)

  return (
    <div className="page">
      <PageHeader kicker="creator" title={'@' + username} right={controls} />

      <div className="hero">
        <div className="hero-avatar" aria-hidden="true">
          {profile?.profilePic ? (
            <img src={profile.profilePic} alt="" loading="lazy" />
          ) : (
            <span>{username.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="hero-main">
          <div className="hero-name">{'@' + username}</div>
          {/* hero-sub only supplies the offset under the name — each .stat restyles itself */}
          <div className="hero-sub statset">
            {stat(profile?.followers ?? 0, 'Followers')}
            {stat(profile?.totalGifs ?? 0, 'Gifs')}
            {stat(profile?.views ?? 0, 'Views')}
          </div>
        </div>
        {authed === true && (
          <button
            type="button"
            className={`btn ${following ? 'on' : ''}`}
            aria-pressed={following}
            disabled={followBusy}
            onClick={toggleFollow}
            title={following ? `Unfollow @${username}` : `Follow @${username}`}
          >
            {following ? 'Following' : 'Follow'}
          </button>
        )}
      </div>

      {tags.length > 0 && (
        <div className="chip-row" style={{ marginBottom: 18 }}>
          {visibleTags.map((t) => (
            <button
              key={t}
              type="button"
              className="chip"
              onClick={() => navigate({ name: 'tag', tag: t })}
            >
              {t}
            </button>
          ))}
          {tags.length > TAG_CAP && (
            <button
              type="button"
              className="chip"
              onClick={() => setShowAllTags((v) => !v)}
            >
              {showAllTags ? 'Show less' : `+${tags.length - TAG_CAP} more`}
            </button>
          )}
        </div>
      )}

      <FeedState
        loading={feed.loading}
        error={feed.error}
        isEmpty={feed.contents.length === 0}
        emptyHint={'@' + username + ' has no ' + typeNoun(type) + ' for this order.'}
        onRetry={feed.reload}
      />

      <FeedGrid
        items={feed.contents}
        mode={mode}
        onOpen={feed.openAt}
        onDownload={download}
        onEndReached={feed.loadMore}
        hasMore={feed.hasMore}
        loading={feed.loading}
        error={feed.error}
        onRetry={feed.loadMore}
      />
    </div>
  )
}
