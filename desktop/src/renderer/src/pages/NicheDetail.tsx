import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import FeedControls from '../components/FeedControls'
import FeedState from '../components/FeedState'
import FeedGrid from '../components/FeedGrid'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useDownload } from '../hooks/useDownload'
import { DEFAULT_ORDER, type Order } from '../lib/feedOptions'

/** A niche's gifs, with an order selector; opening a clip enables niche voting. */
export default function NicheDetail({ id, title }: { id: string; title: string }): JSX.Element {
  const [mode, setMode] = useViewMode('niche', 'grid')
  const [order, setOrder] = useState<Order>(DEFAULT_ORDER)

  const feed = usePlayableFeed(
    (p) => window.api.getNicheGifs(id, order, p),
    title,
    [id, order],
    { nicheId: id }
  )

  const dl = useDownload()

  return (
    <div className="page">
      <PageHeader
        kicker="niche"
        title={title}
        right={
          <FeedControls
            mode={mode}
            onModeChange={setMode}
            order={order}
            onOrderChange={setOrder}
          />
        }
      />

      <FeedState
        loading={feed.loading}
        error={feed.error}
        isEmpty={feed.contents.length === 0}
        emptyMessage="No gifs here yet"
        emptyHint="Nothing has been added to this niche."
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
        error={feed.error}
        onRetry={feed.loadMore}
      />
    </div>
  )
}
