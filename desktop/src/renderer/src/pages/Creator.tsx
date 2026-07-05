import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import FeedControls from '../components/FeedControls'
import FeedState from '../components/FeedState'
import FeedGrid from '../components/FeedGrid'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useNotify } from '../context/notify'
import { useNav } from '../context/nav'
import { formatCount } from '../lib/format'
import { DEFAULT_ORDER, typeNoun, type ContentType, type Order } from '../lib/feedOptions'
import type { Content, UserProfile } from '@shared/types'

const TAG_CAP = 24

/** Creator profile page: header + tag chips + type/order/view controls + feed. */
export default function Creator({ username }: { username: string }): JSX.Element {
  const notify = useNotify()
  const { navigate } = useNav()
  const [mode, setMode] = useViewMode('creator', 'grid')
  const [type, setType] = useState<ContentType>('g')
  const [order, setOrder] = useState<Order>(DEFAULT_ORDER)

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [showAllTags, setShowAllTags] = useState(false)

  useEffect(() => {
    let alive = true
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

  const feed = usePlayableFeed(
    (p) => window.api.getCreatorContent(username, { type, order, page: p }),
    '@' + username,
    [username, type, order]
  )

  const dl = (c: Content): void => {
    window.api
      .downloadContents([c], c.username)
      .then(() => notify('Saving @' + c.username, 'success'))
      .catch((e) => notify('Download failed: ' + (e as Error).message, 'error'))
  }

  const downloadAll = (): void => {
    window.api
      .startDownload({ type: 'user', username })
      .then(() => notify('Queued @' + username + ' — downloading all', 'success'))
      .catch((e) => notify('Download failed: ' + (e as Error).message, 'error'))
  }

  const controls = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <FeedControls
        mode={mode}
        onModeChange={setMode}
        order={order}
        onOrderChange={setOrder}
        type={type}
        onTypeChange={setType}
      />
      <button className="btn btn-ember btn-sm" onClick={downloadAll}>
        Download all
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            flexShrink: 0,
            overflow: 'hidden',
            border: '1px solid var(--line2)',
            background: 'var(--panel)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {profile?.profilePic ? (
            <img
              src={profile.profilePic}
              alt={'@' + username}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span
              style={{
                fontFamily: 'var(--serif)',
                fontSize: 24,
                color: 'var(--dim)'
              }}
            >
              {username.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--serif)',
              fontSize: 22,
              color: 'var(--ink)',
              lineHeight: 1.2
            }}
          >
            {'@' + username}
          </div>
          <div className="statset" style={{ marginTop: 6 }}>
            {stat(profile?.followers ?? 0, 'Followers')}
            {stat(profile?.totalGifs ?? 0, 'Gifs')}
            {stat(profile?.views ?? 0, 'Views')}
          </div>
        </div>
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
        onDownload={dl}
        onEndReached={feed.loadMore}
        hasMore={feed.hasMore}
        loading={feed.loading}
      />
    </div>
  )
}
