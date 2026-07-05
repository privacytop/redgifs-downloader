import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import ViewToggle from '../components/ViewToggle'
import FeedGrid from '../components/FeedGrid'
import EmptyState from '../components/EmptyState'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useNotify } from '../context/notify'
import type { Content } from '@shared/types'

const ORDERS: { id: string; label: string }[] = [
  { id: 'hot', label: 'Hot' },
  { id: 'new', label: 'New' },
  { id: 'best', label: 'Best' },
  { id: 'top', label: 'Top' }
]

/** A niche's gifs, with an order selector; opening a clip enables niche voting. */
export default function NicheDetail({ id, title }: { id: string; title: string }): JSX.Element {
  const notify = useNotify()
  const [mode, setMode] = useViewMode('niche', 'grid')
  const [order, setOrder] = useState('hot')

  const feed = usePlayableFeed(
    (p) => window.api.getNicheGifs(id, order, p),
    title,
    [id, order],
    { nicheId: id }
  )

  const dl = (c: Content): void => {
    window.api
      .downloadContents([c], c.username)
      .then(() => notify('Saving @' + c.username, 'success'))
      .catch((e) => notify('Download failed: ' + (e as Error).message, 'error'))
  }

  return (
    <div className="page">
      <PageHeader
        kicker="niche"
        title={title}
        right={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div className="seg">
              {ORDERS.map((o) => (
                <button key={o.id} className={o.id === order ? 'on' : ''} onClick={() => setOrder(o.id)}>
                  {o.label}
                </button>
              ))}
            </div>
            <ViewToggle value={mode} onChange={setMode} />
          </div>
        }
      />

      {feed.error && <EmptyState message="Couldn't load this niche" hint={feed.error} />}
      {!feed.error && feed.contents.length === 0 && !feed.loading && (
        <EmptyState message="No gifs here yet" hint="Nothing has been added to this niche." />
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
