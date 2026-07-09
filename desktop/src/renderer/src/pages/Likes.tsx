import PageHeader from '../components/PageHeader'
import FeedControls from '../components/FeedControls'
import FeedState from '../components/FeedState'
import SignInGate from '../components/SignInGate'
import FeedGrid from '../components/FeedGrid'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useAuthed } from '../hooks/useAuthed'
import { useNotify } from '../context/notify'
import { useQuality } from '../context/quality'
import type { Content } from '@shared/types'

export default function Likes(): JSX.Element {
  const notify = useNotify()
  const authed = useAuthed()
  const { quality } = useQuality()
  const [mode, setMode] = useViewMode('likes', 'grid')

  const feed = usePlayableFeed((p) => window.api.getLikes(p), 'Likes', [authed])

  const dl = (c: Content): void => {
    window.api
      .downloadContents([c], c.username, quality)
      .then(() => notify('Saving @' + c.username, 'success'))
      .catch((e) => notify('Download failed: ' + e.message, 'error'))
  }

  if (authed === false) {
    return (
      <div className="page">
        <PageHeader kicker="library" kickerIndex={6} title="Likes" />
        <SignInGate
          message="Sign in to see your likes"
          hint="Your liked clips sync once you connect a RedGifs account."
        />
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        kicker="library"
        kickerIndex={6}
        title="Likes"
        right={<FeedControls mode={mode} onModeChange={setMode} />}
      />
      <FeedState
        loading={feed.loading}
        error={feed.error}
        isEmpty={feed.contents.length === 0}
        emptyMessage="Nothing here yet"
        emptyHint="Gifs you like on RedGifs will show up here."
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
