import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import PageHeader from '../components/PageHeader'
import ViewToggle from '../components/ViewToggle'
import FeedGrid from '../components/FeedGrid'
import EmptyState from '../components/EmptyState'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useNotify } from '../context/notify'
import { useNav } from '../context/nav'
import { formatCount } from '../lib/format'
import type { Content, ContentKind, UserProfile } from '@shared/types'

// Orders the /users/{u}/search endpoint actually reorders by (curl-verified).
const ORDERS: { id: string; label: string }[] = [
  { id: 'best', label: 'Best' },
  { id: 'latest', label: 'Latest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'top', label: 'Top' }
]

/** Creator profile page: header + tag chips + type/order/view controls + feed. */
export default function Creator({ username }: { username: string }): JSX.Element {
  const notify = useNotify()
  const { navigate } = useNav()
  const [mode, setMode] = useViewMode('creator', 'grid')
  const [type, setType] = useState<ContentKind>('g')
  const [order, setOrder] = useState<string>('best')

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [tags, setTags] = useState<string[]>([])

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
      <div className="seg" role="group" aria-label="Content type">
        <button type="button" className={type === 'g' ? 'on' : ''} onClick={() => setType('g')}>
          Videos
        </button>
        <button type="button" className={type === 'i' ? 'on' : ''} onClick={() => setType('i')}>
          Images
        </button>
      </div>
      <select
        value={order}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => setOrder(e.target.value)}
        aria-label="Sort order"
        style={{
          background: 'var(--panel)',
          color: 'var(--cream)',
          border: '1px solid var(--line)',
          borderRadius: 6,
          padding: '6px 10px',
          font: 'inherit',
          fontFamily: 'var(--mono, "Space Mono", monospace)',
          fontSize: 12,
          cursor: 'pointer'
        }}
      >
        {ORDERS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <ViewToggle value={mode} onChange={setMode} />
      <button className="btn btn-ember btn-sm" onClick={downloadAll}>
        Download all
      </button>
    </div>
  )

  const statText = 'var(--cream)'
  const statLabel = 'var(--mut)'
  const stat = (value: number, label: string): JSX.Element => (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span
        style={{
          fontFamily: 'var(--mono, "Space Mono", monospace)',
          fontSize: 14,
          color: statText
        }}
      >
        {formatCount(value)}
      </span>
      <span
        style={{
          fontFamily: 'var(--mono, "Space Mono", monospace)',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: statLabel
        }}
      >
        {label}
      </span>
    </span>
  )

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
                fontFamily: 'var(--serif, "Fraunces", serif)',
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
              fontFamily: 'var(--serif, "Fraunces", serif)',
              fontSize: 22,
              color: 'var(--ink)',
              lineHeight: 1.2
            }}
          >
            {'@' + username}
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
              marginTop: 6
            }}
          >
            {stat(profile?.followers ?? 0, 'Followers')}
            {stat(profile?.totalGifs ?? 0, 'Gifs')}
            {stat(profile?.views ?? 0, 'Views')}
          </div>
        </div>
      </div>

      {tags.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 18
          }}
        >
          {tags.slice(0, 24).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => navigate({ name: 'tag', tag: t })}
              style={{
                fontFamily: 'var(--mono, "Space Mono", monospace)',
                fontSize: 11,
                letterSpacing: '0.04em',
                color: 'var(--mut)',
                border: '1px solid var(--line)',
                borderRadius: 999,
                padding: '3px 10px',
                background: 'var(--panel)',
                cursor: 'pointer'
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {feed.error && <EmptyState message="Couldn't load" hint={feed.error} />}
      {!feed.error && feed.contents.length === 0 && !feed.loading && (
        <EmptyState message="Nothing here yet" hint={'@' + username + ' has no ' + (type === 'g' ? 'videos' : 'images') + ' for this order.'} />
      )}

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
