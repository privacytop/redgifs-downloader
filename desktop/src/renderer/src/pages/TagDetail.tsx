import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import FeedControls from '../components/FeedControls'
import FeedGrid from '../components/FeedGrid'
import FeedState from '../components/FeedState'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useNotify } from '../context/notify'
import { useQuality } from '../context/quality'
import { DEFAULT_ORDER, type Order, type ContentType } from '../lib/feedOptions'
import type { Content } from '@shared/types'

/** Browse the latest gifs for a single tag (`#tag`). */
export default function TagDetail({ tag }: { tag: string }): JSX.Element {
  const notify = useNotify()
  const { quality } = useQuality()
  const [mode, setMode] = useViewMode('tag')
  const [order, setOrder] = useState<Order>(DEFAULT_ORDER)
  const [type, setType] = useState<ContentType>('g')

  const feed = usePlayableFeed(
    (p) => window.api.searchGifs({ search: tag, order, type, page: p }),
    '#' + tag,
    [tag, order, type]
  )

  const dl = (c: Content): void => {
    window.api
      .downloadContents([c], c.username, quality)
      .then(() => notify('Saving @' + c.username, 'success'))
      .catch((e) => notify('Download failed: ' + (e as Error).message, 'error'))
  }

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
      />
    </div>
  )
}
