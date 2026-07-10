import { useLocation, useParams } from 'react-router-dom'
import type { Content } from '@redloader/core'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import { usePlayer } from '../player/PlayerProvider'
import MediaGrid from '../components/MediaGrid'

/** One collection's gifs. */
export default function CollectionDetail(): React.JSX.Element {
  const { id = '' } = useParams()
  const location = useLocation()
  const title = (location.state as { title?: string } | null)?.title ?? 'Collection'
  const player = usePlayer()

  const feed = usePagedFeed((p) => api.getCollectionContent(id, p), [id])

  const open = (_c: Content, index: number): void => {
    player.open({ items: feed.items, index, label: title, loadMore: feed.loadMoreItems })
  }

  return (
    <div className="page">
      <h1 className="title">{title}</h1>
      <hr className="rule" />
      {feed.error && feed.items.length === 0 ? (
        <div className="empty">
          <div className="empty-msg">Couldn’t load</div>
          <div className="empty-sub">{feed.error}</div>
          <button className="btn" onClick={feed.reload}>Try again</button>
        </div>
      ) : !feed.loading && feed.items.length === 0 ? (
        <div className="empty"><div className="empty-msg">Empty collection</div></div>
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
