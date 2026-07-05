import { useState } from 'react'
import type { Content } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ViewToggle from '../components/ViewToggle'
import FeedGrid from '../components/FeedGrid'
import FeedState from '../components/FeedState'
import SignInGate from '../components/SignInGate'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useNotify } from '../context/notify'
import { useAuthed } from '../hooks/useAuthed'

type Tab = 'for-you' | 'trending'

/**
 * Home page with two gif feeds: "For you" (personal, requires auth) and
 * "Trending" (popular, public). One feed that refetches when the tab changes.
 */
export default function ForYou(): JSX.Element {
  const notify = useNotify()
  const [mode, setMode] = useViewMode('for-you', 'grid')
  const authed = useAuthed()
  const [tab, setTab] = useState<Tab>('for-you')

  const feed = usePlayableFeed(
    (p) => (tab === 'trending' ? window.api.getTrending(p) : window.api.getForYou(p)),
    tab === 'trending' ? 'Trending' : 'For you',
    [tab, authed]
  )

  const dl = (c: Content): void => {
    window.api
      .downloadContents([c], c.username)
      .then(() => notify('Saving @' + c.username, 'success'))
      .catch((e) => notify('Download failed: ' + e.message, 'error'))
  }

  const tabs = (
    <div className="seg" role="group" aria-label="Feed">
      <button
        type="button"
        className={tab === 'for-you' ? 'on' : ''}
        aria-pressed={tab === 'for-you'}
        onClick={() => setTab('for-you')}
      >
        For you
      </button>
      <button
        type="button"
        className={tab === 'trending' ? 'on' : ''}
        aria-pressed={tab === 'trending'}
        onClick={() => setTab('trending')}
      >
        Trending
      </button>
    </div>
  )

  // Only the personal feed needs auth; Trending is public.
  const gated = tab === 'for-you' && authed === false

  return (
    <div className="page">
      <PageHeader
        kicker="home"
        kickerIndex={1}
        title={tab === 'trending' ? 'Trending' : 'For you'}
        right={
          <div className="controls">
            {tabs}
            <ViewToggle value={mode} onChange={setMode} />
          </div>
        }
      />

      {gated ? (
        <>
          <SignInGate
            message="Sign in for your personal feed"
            hint="Or browse Trending — no account needed."
          />
          <div className="empty">
            <button className="btn" type="button" onClick={() => setTab('trending')}>
              Browse Trending
            </button>
          </div>
        </>
      ) : (
        <>
          <FeedState
            loading={feed.loading}
            error={feed.error}
            isEmpty={feed.contents.length === 0}
            emptyMessage="Nothing here yet"
            emptyHint="Come back a little later."
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
        </>
      )}
    </div>
  )
}
