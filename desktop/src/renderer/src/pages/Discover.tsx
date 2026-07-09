import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import FeedControls from '../components/FeedControls'
import FeedGrid from '../components/FeedGrid'
import FeedState from '../components/FeedState'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useDownload } from '../hooks/useDownload'
import type { Order, ContentType } from '../lib/feedOptions'

/** Browse RedGifs by content type, order, and verified status. */
export default function Discover(): JSX.Element {
  const [type, setType] = useState<ContentType>('g')
  const [order, setOrder] = useState<Order>('latest')
  const [verified, setVerified] = useState(false)
  const [mode, setMode] = useViewMode('discover', 'grid')

  const feed = usePlayableFeed(
    (p) => window.api.searchGifs({ type, order, page: p, verified }),
    'Discover',
    [type, order, verified]
  )

  const dl = useDownload()

  const kicker = `${order} · ${type === 'g' ? 'videos' : 'images'}`

  return (
    <div className="page">
      <PageHeader
        kicker={kicker}
        kickerIndex={2}
        title="Discover"
        right={
          <FeedControls
            mode={mode}
            onModeChange={setMode}
            order={order}
            onOrderChange={setOrder}
            type={type}
            onTypeChange={setType}
            verified={verified}
            onVerifiedChange={setVerified}
          />
        }
      />

      <FeedState
        loading={feed.loading}
        error={feed.error}
        isEmpty={feed.contents.length === 0}
        onRetry={feed.reload}
        emptyHint="Try a different order or content type."
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
