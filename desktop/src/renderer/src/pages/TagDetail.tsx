import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import FeedControls from '../components/FeedControls'
import FeedGrid from '../components/FeedGrid'
import FeedState from '../components/FeedState'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useDownload } from '../hooks/useDownload'
import { DEFAULT_ORDER, type Order, type ContentType } from '../lib/feedOptions'

/** Browse the latest gifs for a single tag (`#tag`). */
export default function TagDetail({ tag }: { tag: string }): JSX.Element {
  const [mode, setMode] = useViewMode('tag', 'grid')
  const [order, setOrder] = useState<Order>(DEFAULT_ORDER)
  const [type, setType] = useState<ContentType>('g')

  const feed = usePlayableFeed(
    (p) => window.api.searchGifs({ search: tag, order, type, page: p }),
    '#' + tag,
    [tag, order, type]
  )

  const dl = useDownload()

  return (
    <div className="page">
      <PageHeader
        kicker="tag"
        title={'#' + tag}
        right={
          <FeedControls
            mode={mode}
            onModeChange={setMode}
            order={order}
            onOrderChange={setOrder}
            type={type}
            onTypeChange={setType}
          />
        }
      />

      <FeedState
        loading={feed.loading}
        error={feed.error}
        isEmpty={feed.contents.length === 0}
        onRetry={feed.reload}
        emptyHint={'No recent gifs for #' + tag + '.'}
      />

      <FeedGrid
        items={feed.contents}
        mode={mode}
        onOpen={feed.openAt}
        onDownload={dl}
        onEndReached={feed.loadMore}
        hasMore={feed.hasMore}
        loading={feed.loading}
        error={feed.error}
        onRetry={feed.loadMore}
      />
    </div>
  )
}
