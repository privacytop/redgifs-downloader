import { useEffect } from 'react'
import PageHeader from '../components/PageHeader'
import FeedControls from '../components/FeedControls'
import FeedGrid from '../components/FeedGrid'
import FeedState from '../components/FeedState'
import SignInGate from '../components/SignInGate'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useAuthed } from '../hooks/useAuthed'
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
  const authed = useAuthed()
  const [mode, setMode] = useViewMode('collection', 'grid')
  const feed = usePlayableFeed((p) => window.api.getCollectionContent(id, p), title, [id])

  // Refresh when a gif is added to / removed from THIS collection (e.g. via the
  // player's collection menu), so the grid reflects it without reopening.
  const reload = feed.reload
  useEffect(() => {
    const onChange = (e: Event): void => {
      if ((e as CustomEvent<{ folderId?: string }>).detail?.folderId === id) reload()
    }
    window.addEventListener('rgd:collection-changed', onChange)
    return () => window.removeEventListener('rgd:collection-changed', onChange)
  }, [id, reload])

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

  if (authed === false) {
    return (
      <div className="page">
        <PageHeader kicker="collection" kickerIndex={5} title={title} />
        <SignInGate message="Sign in to view this collection" />
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        kicker="collection"
        kickerIndex={5}
        title={title}
        right={
          <>
            <FeedControls mode={mode} onModeChange={setMode} />
            <button
              className="btn btn-ember btn-sm"
              onClick={downloadAll}
              disabled={feed.loading || feed.contents.length === 0}
            >
              Download all
            </button>
          </>
        }
      />

      <FeedState
        loading={feed.loading}
        error={feed.error}
        isEmpty={feed.contents.length === 0}
        emptyMessage="This collection is empty"
        emptyHint="Nothing has been added here yet."
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
