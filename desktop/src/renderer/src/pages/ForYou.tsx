import { useState } from 'react'
import type { Content } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ViewToggle from '../components/ViewToggle'
import FeedGrid from '../components/FeedGrid'
import EmptyState from '../components/EmptyState'
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
    <div className="seg">
      <button className={tab === 'for-you' ? 'on' : ''} onClick={() => setTab('for-you')}>
        For you
      </button>
      <button className={tab === 'trending' ? 'on' : ''} onClick={() => setTab('trending')}>
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
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {tabs}
            <ViewToggle value={mode} onChange={setMode} />
          </div>
        }
      />

      {gated ? (
        <EmptyState
          message="Sign in to see this"
          hint="Your personalized feed is tailored to your RedGifs account. Or check out Trending →"
          action={
            <button className="btn btn-ember" onClick={() => window.api.login()}>
              Sign in
            </button>
          }
        />
      ) : (
        <>
          {feed.error && <EmptyState message="Couldn't load" hint={feed.error} />}
          {!feed.error && feed.contents.length === 0 && !feed.loading && (
            <EmptyState message="Nothing here yet" hint="Come back a little later." />
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
        </>
      )}
    </div>
  )
}
