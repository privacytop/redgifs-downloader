import PageHeader from '../components/PageHeader'
import ViewToggle from '../components/ViewToggle'
import FeedGrid from '../components/FeedGrid'
import EmptyState from '../components/EmptyState'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useNotify } from '../context/notify'
import type { Content } from '@shared/types'

/** Browse the latest gifs for a single tag (`#tag`). */
export default function TagDetail({ tag }: { tag: string }): JSX.Element {
  const notify = useNotify()
  const [mode, setMode] = useViewMode('tag')

  const feed = usePlayableFeed(
    (p) => window.api.searchGifs({ search: tag, order: 'latest', page: p }),
    '#' + tag,
    [tag]
  )

  const dl = (c: Content): void => {
    window.api
      .downloadContents([c], c.username)
      .then(() => notify('Saving @' + c.username, 'success'))
      .catch((e) => notify('Download failed: ' + (e as Error).message, 'error'))
  }

  return (
    <div className="page">
      <PageHeader kicker="tag" title={'#' + tag} right={<ViewToggle value={mode} onChange={setMode} />} />

      {feed.error && <EmptyState message="Couldn't load" hint={feed.error} />}
      {!feed.error && feed.contents.length === 0 && !feed.loading && (
        <EmptyState message="Nothing tagged here" hint={'No recent gifs for #' + tag + '.'} />
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
