import { useCallback, useEffect, useRef, useState } from 'react'
import type { Content, UserResult } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ViewToggle from '../components/ViewToggle'
import FeedGrid from '../components/FeedGrid'
import EmptyState from '../components/EmptyState'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useNotify } from '../context/notify'
import { useNav } from '../context/nav'
import { useAuthed } from '../hooks/useAuthed'
import { formatCount } from '../lib/format'

type Tab = 'for-you' | 'trending'

function CreatorCard({ user, onOpen }: { user: UserResult; onOpen: () => void }): JSX.Element {
  const initial = (user.name || user.username || '?').trim().charAt(0).toUpperCase() || '?'
  return (
    <button
      onClick={onOpen}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        textAlign: 'center',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: 14,
        cursor: 'pointer',
        color: 'var(--ink)',
        width: '100%',
        font: 'inherit'
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--ember)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--line)')}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          overflow: 'hidden',
          background: 'linear-gradient(135deg, var(--ember), var(--ember2))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--cream)',
          fontFamily: 'Fraunces, serif',
          fontSize: 24,
          fontWeight: 600,
          flex: '0 0 auto'
        }}
      >
        {user.profileImageUrl ? (
          <img src={user.profileImageUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          initial
        )}
      </div>
      <div
        style={{
          fontFamily: 'Fraunces, serif',
          fontSize: 16,
          color: 'var(--cream)',
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        @{user.username}
      </div>
      <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 11, color: 'var(--mut)', letterSpacing: '0.02em' }}>
        {formatCount(user.followers)} followers · {formatCount(user.gifs)} gifs
      </div>
    </button>
  )
}

/**
 * Home page with two tabs: "For you" (personal gif feed, requires auth) and
 * "Trending" (trending verified creators, public).
 */
export default function ForYou(): JSX.Element {
  const notify = useNotify()
  const nav = useNav()
  const [mode, setMode] = useViewMode('for-you', 'grid')
  const authed = useAuthed()
  const [tab, setTab] = useState<Tab>('for-you')

  // --- For you: gif feed ---
  const feed = usePlayableFeed((p) => window.api.getForYou(p), 'For you', [authed])
  const dl = (c: Content): void => {
    window.api
      .downloadContents([c], c.username)
      .then(() => notify('Saving @' + c.username, 'success'))
      .catch((e) => notify('Download failed: ' + e.message, 'error'))
  }

  // --- Trending: creator grid (public), infinite scroll ---
  const [creators, setCreators] = useState<UserResult[]>([])
  const [tLoading, setTLoading] = useState(false)
  const [tHasMore, setTHasMore] = useState(true)
  const [tError, setTError] = useState<string | null>(null)
  const tPage = useRef(1)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const loadTrending = useCallback(() => {
    if (tLoading || !tHasMore) return
    setTLoading(true)
    setTError(null)
    const page = tPage.current
    window.api
      .getTrendingCreators(page)
      .then((res) => {
        const list = res.items ?? []
        setCreators((prev) => {
          const seen = new Set(prev.map((c) => c.username))
          return [...prev, ...list.filter((c) => !seen.has(c.username))]
        })
        setTHasMore(res.page < res.pages)
        tPage.current = res.page + 1
      })
      .catch((e: Error) => {
        setTHasMore(false)
        if (page === 1) setTError(e.message)
      })
      .finally(() => setTLoading(false))
  }, [tLoading, tHasMore])

  // First load when the Trending tab is opened.
  useEffect(() => {
    if (tab === 'trending' && creators.length === 0) loadTrending()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // Infinite scroll for creators.
  useEffect(() => {
    if (tab !== 'trending') return
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadTrending()
      },
      { rootMargin: '500px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [tab, loadTrending, tHasMore, creators.length])

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

  const right =
    tab === 'for-you' ? (
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {tabs}
        <ViewToggle value={mode} onChange={setMode} />
      </div>
    ) : (
      tabs
    )

  return (
    <div className="page">
      <PageHeader
        kicker="home"
        kickerIndex={1}
        title={tab === 'trending' ? 'Trending' : 'For you'}
        right={right}
      />

      {tab === 'for-you' ? (
        authed === false ? (
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
          </>
        )
      ) : (
        <>
          {tError && <EmptyState message="Couldn't load trending" hint={tError} />}
          {!tError && creators.length === 0 && !tLoading && (
            <EmptyState message="No trending creators right now" />
          )}
          {creators.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 14
              }}
            >
              {creators.map((u) => (
                <CreatorCard key={u.username} user={u} onOpen={() => nav.navigate({ name: 'creator', username: u.username })} />
              ))}
            </div>
          )}
          {tHasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
          {tLoading && creators.length > 0 && (
            <div style={{ textAlign: 'center', marginTop: 20, fontFamily: 'Space Mono, monospace', fontSize: 12, color: 'var(--dim)' }}>
              Loading…
            </div>
          )}
        </>
      )}
    </div>
  )
}
