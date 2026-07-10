import { useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import { usePlayer } from '../player/PlayerProvider'
import MediaGrid from '../components/MediaGrid'
import type { Content } from '@redloader/core'

type Order = 'best' | 'new' | 'top'

const ORDERS: { key: Order; label: string }[] = [
  { key: 'best', label: 'Best' },
  { key: 'new', label: 'New' },
  { key: 'top', label: 'Top' }
]

/**
 * NicheDetail: gifs inside one niche. Title comes from navigation state (set by
 * the linking screen) and falls back to 'Niche'. A .seg switches the feed order.
 */
export default function NicheDetail(): React.JSX.Element {
  const player = usePlayer()
  const { id = '' } = useParams()
  const location = useLocation()
  const title = (location.state as { title?: string } | null)?.title ?? 'Niche'
  const [order, setOrder] = useState<Order>('best')

  const feed = usePagedFeed((p) => api.getNicheGifs(id, order, p), [id, order])

  const open = (_c: Content, index: number): void => {
    player.open({ items: feed.items, index, label: title, loadMore: feed.loadMoreItems })
  }

  return (
    <div className="page">
      <div className="kicker">Niche</div>
      <h1 className="title">{title}</h1>

      <div style={{ margin: '12px 0 18px' }}>
        <div className="seg" role="group" aria-label="Order">
          {ORDERS.map((o) => (
            <button key={o.key} className={order === o.key ? 'on' : ''} onClick={() => setOrder(o.key)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {feed.error && feed.items.length === 0 ? (
        <div className="empty">
          <div className="empty-msg">Couldn’t load</div>
          <div className="empty-sub">{feed.error}</div>
          <button className="btn" onClick={feed.reload}>Try again</button>
        </div>
      ) : !feed.loading && feed.items.length === 0 ? (
        <div className="empty">
          <div className="empty-msg">Nothing here yet</div>
          <div className="empty-sub">This niche has no gifs for this order.</div>
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
