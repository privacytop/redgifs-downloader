import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import { usePlayer } from '../player/PlayerProvider'
import MediaGrid from '../components/MediaGrid'
import type { Content } from '@redloader/core'

type Order = 'latest' | 'best' | 'top'

/**
 * TagDetail: every gif under a single #tag, ordered latest / best / top.
 * Same paginator drives the grid and the swipe player, so paging keeps going.
 */
export default function TagDetail(): React.JSX.Element {
  const player = usePlayer()
  const { tag: raw } = useParams<{ tag: string }>()
  const tag = decodeURIComponent(raw ?? '')
  const [order, setOrder] = useState<Order>('latest')

  const feed = usePagedFeed(
    (p) => api.searchGifs({ tags: tag, order, page: p }),
    [tag, order],
    `feed:tag:${tag}:${order}`
  )

  const open = (_c: Content, index: number): void => {
    player.open({ items: feed.items, index, label: `#${tag}`, loadMore: feed.loadMoreItems })
  }

  return (
    <div className="page">
      <h1 className="title">#{tag}</h1>
      <div style={{ margin: '12px 0 18px' }}>
        <div className="seg" role="group" aria-label="Sort">
          <button className={order === 'latest' ? 'on' : ''} onClick={() => setOrder('latest')}>
            Latest
          </button>
          <button className={order === 'best' ? 'on' : ''} onClick={() => setOrder('best')}>
            Best
          </button>
          <button className={order === 'top' ? 'on' : ''} onClick={() => setOrder('top')}>
            Top
          </button>
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
          <div className="empty-msg">Nothing tagged #{tag}</div>
          <div className="empty-sub">No gifs match this tag right now. Try another sort.</div>
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
