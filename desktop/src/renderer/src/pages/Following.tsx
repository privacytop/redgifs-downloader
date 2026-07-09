import { useCallback, useEffect, useRef, useState } from 'react'
import PageHeader from '../components/PageHeader'
import FeedState from '../components/FeedState'
import SignInGate from '../components/SignInGate'
import CreatorCard from '../components/CreatorCard'
import { useNav } from '../context/nav'
import { useAuthed } from '../hooks/useAuthed'
import { readCache } from '../lib/cache'
import type { UserResult } from '@shared/types'

/** Creators the signed-in user follows. Paginated grid of creator cards. */
export default function Following(): JSX.Element {
  const nav = useNav()

  const authed = useAuthed()
  const [creators, setCreators] = useState<UserResult[]>(() => readCache<UserResult[]>('following') ?? [])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pageRef = useRef(1)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const loadMore = useCallback((force = false) => {
    if (loading || (!hasMore && !force)) return
    setLoading(true)
    setError(null)
    window.api
      .getFollowing(pageRef.current)
      .then((res) => {
        const list = res.items ?? []
        setCreators((prev) => {
          const seen = new Set(prev.map((c) => c.username))
          return [...prev, ...list.filter((c) => !seen.has(c.username))]
        })
        // Stop at the real last page (avoids a 400 on the page past the end).
        setHasMore(res.page < res.pages)
        pageRef.current = res.page + 1
      })
      .catch((e: Error) => {
        // Surface the failure but keep hasMore — pageRef never advanced, so a
        // retry (inline row here, FeedState on page 1) resumes from this page.
        setError(e.message)
      })
      .finally(() => setLoading(false))
  }, [loading, hasMore])

  // Retry re-requests the page that just failed.
  const retry = useCallback(() => {
    setError(null)
    loadMore(true)
  }, [loadMore])

  useEffect(() => {
    if (authed) loadMore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed])

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore()
      },
      { rootMargin: '400px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore, hasMore, authed, creators.length])

  if (authed === false) {
    return (
      <div className="page">
        <PageHeader kicker="following" kickerIndex={3} title="Following" />
        <SignInGate hint="Your followed creators live behind your RedGifs account." />
      </div>
    )
  }

  // Only "empty" once auth has resolved and a load has settled — otherwise the
  // empty message flashes in the window before the first fetch starts.
  const isEmpty = authed === true && creators.length === 0

  // Mid-list failure (content already on screen): FeedState stays silent, so
  // render the same inline error row FeedGrid uses instead of stopping dead.
  const failed = Boolean(error) && creators.length > 0 && !loading

  return (
    <div className="page">
      <PageHeader kicker="following" kickerIndex={3} title="Following" />

      <FeedState
        loading={loading || authed === null}
        error={error}
        isEmpty={isEmpty}
        emptyMessage="You’re not following anyone yet"
        emptyHint="Follow creators on RedGifs and they’ll show up here."
        onRetry={retry}
      />

      {creators.length > 0 && (
        <div className="creator-row">
          {creators.map((u) => (
            <CreatorCard
              key={u.username}
              user={u}
              onOpen={(username) => nav.navigate({ name: 'creator', username })}
            />
          ))}
        </div>
      )}

      {loading && creators.length > 0 && <div className="feed-loading">Loading…</div>}
      {failed && (
        <div className="feed-error" role="alert">
          <span>Couldn’t load more — {error}</span>
          <button type="button" className="btn btn-sm" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {authed === true && hasMore && !failed && (
        <div ref={sentinelRef} className="feed-sentinel" aria-hidden="true" />
      )}
    </div>
  )
}
