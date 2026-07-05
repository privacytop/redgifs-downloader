import PageHeader from '../components/PageHeader'
import ViewToggle from '../components/ViewToggle'
import FeedGrid from '../components/FeedGrid'
import EmptyState from '../components/EmptyState'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useNotify } from '../context/notify'
import type { Content } from '@shared/types'

/** A single collection's contents, with a "Download all" action. */
export default function CollectionDetail({
  id,
  title
}: {
  id: string
  title: string
}): JSX.Element {
  const notify = useNotify()
  const [mode, setMode] = useViewMode('collection', 'grid')
  const feed = usePlayableFeed((p) => window.api.getCollectionContent(id, p), title, [id])

  const dl = (c: Content): void => {
    window.api
      .downloadContents([c], c.username)
      .then(() => notify('Saving @' + c.username, 'success'))
      .catch((e) => notify('Download failed: ' + (e as Error).message, 'error'))
  }

  const downloadAll = (): void => {
    window.api
      .startDownload({ type: 'collection', collectionId: id })
      .then(() => notify('Downloading collection · ' + title, 'success'))
      .catch((e) => notify('Download failed: ' + (e as Error).message, 'error'))
  }

  return (
    <div className="page">
      <PageHeader
        kicker="collection"
        title={title}
        right={
          <>
            <ViewToggle value={mode} onChange={setMode} />
            <button className="btn btn-ember btn-sm" onClick={downloadAll}>
              Download all
            </button>
          </>
        }
      />

      {feed.error && <EmptyState message="Couldn't load this collection" hint={feed.error} />}
      {!feed.error && feed.contents.length === 0 && !feed.loading && (
        <EmptyState message="This collection is empty" hint="Nothing has been added here yet." />
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
