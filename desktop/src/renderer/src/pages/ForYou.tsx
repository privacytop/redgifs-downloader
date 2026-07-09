import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import ViewToggle from '../components/ViewToggle'
import FeedGrid from '../components/FeedGrid'
import FeedState from '../components/FeedState'
import EmptyState from '../components/EmptyState'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useDownload } from '../hooks/useDownload'
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
  const [signingIn, setSigningIn] = useState(false)
  const dl = useDownload()

  const feed = usePlayableFeed(
    (p) => {
      // The personal feed is a guaranteed 401 while signed out (or still
      // resolving) — resolve empty instead of calling the API from behind the
      // sign-in gate. `authed` is in the deps, so signing in refetches.
      if (tab === 'for-you' && !authed) {
        return Promise.resolve({ contents: [], page: 1, pages: 1, total: 0 })
      }
      return tab === 'trending' ? window.api.getTrending(p) : window.api.getForYou(p)
    },
    tab === 'trending' ? 'Trending' : 'For you',
    [tab, authed]
  )

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
        // One gate, two ways out: sign in, or hop to the public feed. Inlined
        // (rather than SignInGate) because the gate needs a second action.
        <EmptyState
          message="Sign in for your personal feed"
          hint="Or browse Trending — no account needed."
          action={
            <div className="controls">
              <button
                className="btn btn-ember"
                type="button"
                disabled={signingIn}
                onClick={() => {
                  setSigningIn(true)
                  window.api
                    .login()
                    .catch((e) => notify('Sign-in failed: ' + (e as Error).message, 'error'))
                    .finally(() => setSigningIn(false))
                }}
              >
                Sign in
              </button>
              <button className="btn" type="button" onClick={() => setTab('trending')}>
                Browse Trending
              </button>
            </div>
          }
        />
      ) : (
        <>
          <FeedState
            loading={feed.loading || (tab === 'for-you' && authed === null)}
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
            error={feed.error}
            onRetry={feed.loadMore}
          />
        </>
      )}
    </div>
  )
}
