import { useCallback, useEffect, useRef, useState } from 'react'
import PageHeader from '../components/PageHeader'
import FeedState from '../components/FeedState'
import SignInGate from '../components/SignInGate'
import { useNav } from '../context/nav'
import { useAuthed } from '../hooks/useAuthed'
import { formatCount } from '../lib/format'
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
    const page = pageRef.current
    window.api
      .getFollowing(page)
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
        setHasMore(false)
        if (page === 1) setError(e.message) // only surface a genuine first-page failure
      })
      .finally(() => setLoading(false))
  }, [loading, hasMore])

  // A first-page failure sets hasMore=false, which would make loadMore's guard
  // reject a retry — so retry re-opens the gate and forces a fresh fetch.
  const retry = useCallback(() => {
    setError(null)
    setHasMore(true)
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
              onOpen={() => nav.navigate({ name: 'creator', username: u.username })}
            />
          ))}
        </div>
      )}

      {authed === true && hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
      {loading && creators.length > 0 && <div className="readout">Loading…</div>}
    </div>
  )
}

/** A single creator result: avatar + @name, click → creator page. */
function CreatorCard({ user, onOpen }: { user: UserResult; onOpen: () => void }): JSX.Element {
  return (
    <button type="button" className="creator-card" onClick={onOpen} title={`View @${user.username}`}>
      <div className="creator-avatar" aria-hidden="true">
        {user.profileImageUrl ? (
          <img src={user.profileImageUrl} alt={'@' + user.username} loading="lazy" />
        ) : (
          <span>{(user.name || user.username || '?').trim().charAt(0).toUpperCase() || '?'}</span>
        )}
      </div>
      <div className="creator-info">
        <div className="creator-name">@{user.username}</div>
        <div className="creator-sub">
          {formatCount(user.followers)} followers · {formatCount(user.gifs)} gifs
        </div>
      </div>
    </button>
  )
}
