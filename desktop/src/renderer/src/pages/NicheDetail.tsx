import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import FeedControls from '../components/FeedControls'
import FeedState from '../components/FeedState'
import FeedGrid from '../components/FeedGrid'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useNotify } from '../context/notify'
import { DEFAULT_ORDER, type Order } from '../lib/feedOptions'
import type { Content } from '@shared/types'

/** A niche's gifs, with an order selector; opening a clip enables niche voting. */
export default function NicheDetail({ id, title }: { id: string; title: string }): JSX.Element {
  const notify = useNotify()
  const [mode, setMode] = useViewMode('niche', 'grid')
  const [order, setOrder] = useState<Order>(DEFAULT_ORDER)

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
      />
    </div>
  )
}
