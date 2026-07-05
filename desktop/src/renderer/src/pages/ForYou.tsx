import type { Content } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ViewToggle from '../components/ViewToggle'
import FeedGrid from '../components/FeedGrid'
import EmptyState from '../components/EmptyState'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useNotify } from '../context/notify'
import { useAuthed } from '../hooks/useAuthed'

/** Personal recommendation feed — requires auth (getForYou is per-user). */
export default function ForYou(): JSX.Element {
  const notify = useNotify()
  const [mode, setMode] = useViewMode('for-you', 'grid')
  const authed = useAuthed()

  const feed = usePlayableFeed((p) => window.api.getForYou(p), 'For you', [authed])

  const dl = (c: Content): void => {
    window.api
      .downloadContents([c], c.username)
      .then(() => notify('Saving @' + c.username, 'success'))
      .catch((e) => notify('Download failed: ' + e.message, 'error'))
  }

  if (authed === false) {
    return (
      <div className="page">
        <PageHeader kicker="for you" kickerIndex={1} title="For you" />
        <EmptyState
          message="Sign in to see this"
          hint="Your personalized feed is tailored to your RedGifs account."
          action={
            <button className="btn btn-ember" onClick={() => window.api.login()}>
              Sign in
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        kicker="for you"
        kickerIndex={1}
        title="For you"
        right={<ViewToggle value={mode} onChange={setMode} />}
      />
      {feed.error && <EmptyState message="Couldn't load your feed" hint={feed.error} />}
      {!feed.error && feed.contents.length === 0 && !feed.loading && (
        <EmptyState message="Nothing here yet" hint="Come back once you've watched a few clips." />
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
