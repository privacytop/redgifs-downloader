import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import ViewToggle from '../components/ViewToggle'
import FeedGrid from '../components/FeedGrid'
import EmptyState from '../components/EmptyState'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useNotify } from '../context/notify'
import type { Content } from '@shared/types'

type ContentType = 'g' | 'i'

const ORDERS: { id: string; label: string }[] = [
  { id: 'trending', label: 'Trending' },
  { id: 'latest', label: 'Latest' },
  { id: 'best', label: 'Best' },
  { id: 'top', label: 'Top' },
  { id: 'new', label: 'New' }
]

/** Browse RedGifs by content type, order, and verified status. */
export default function Discover(): JSX.Element {
  const notify = useNotify()
  const [type, setType] = useState<ContentType>('g')
  const [order, setOrder] = useState('trending')
  const [verified, setVerified] = useState(false)
  const [mode, setMode] = useViewMode('discover', 'grid')

  const feed = usePlayableFeed(
    (p) => window.api.searchGifs({ type, order, page: p, verified }),
    'Discover',
    [type, order, verified]
  )

  const dl = (c: Content): void => {
    window.api
      .downloadContents([c], c.username)
      .then(() => notify('Saving @' + c.username, 'success'))
      .catch((e) => notify('Download failed: ' + (e as Error).message, 'error'))
  }

  const kicker = `${order} · ${type === 'g' ? 'videos' : 'images'}`

  return (
    <div className="page">
      <PageHeader
        kicker={kicker}
        kickerIndex={2}
        title="Discover"
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div className="seg" role="group" aria-label="Content type">
              <button
                type="button"
                className={type === 'g' ? 'on' : ''}
                aria-pressed={type === 'g'}
                onClick={() => setType('g')}
              >
                Videos
              </button>
              <button
                type="button"
                className={type === 'i' ? 'on' : ''}
                aria-pressed={type === 'i'}
                onClick={() => setType('i')}
              >
                Images
              </button>
            </div>
            <select
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              aria-label="Order"
              style={{
                appearance: 'none',
                background: 'var(--panel)',
                color: 'var(--ink)',
                border: '1px solid var(--line)',
                borderRadius: 8,
                padding: '7px 12px',
                font: 'inherit',
                fontFamily: 'var(--mono, monospace)',
                fontSize: 12,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                cursor: 'pointer'
              }}
            >
              {ORDERS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={verified ? 'btn btn-sm btn-ember' : 'btn btn-sm btn-ghost'}
              aria-pressed={verified}
              onClick={() => setVerified((v) => !v)}
            >
              Verified
            </button>
            <ViewToggle value={mode} onChange={setMode} />
          </div>
        }
      />

      {feed.error && <EmptyState message="Couldn't load" hint={feed.error} />}
      {!feed.error && feed.contents.length === 0 && !feed.loading && (
        <EmptyState message="Nothing here yet" hint="Try a different order or content type." />
      )}

      <FeedGrid items={feed.contents} mode={mode} onOpen={feed.openAt} onDownload={dl} />

      {feed.hasMore && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button className="btn" onClick={feed.loadMore} disabled={feed.loading}>
            {feed.loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
