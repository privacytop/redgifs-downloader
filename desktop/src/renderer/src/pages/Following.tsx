import { useCallback, useEffect, useRef, useState } from 'react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useNav } from '../context/nav'
import { useNotify } from '../context/notify'
import { formatCount } from '../lib/format'
import { readCache, writeCache } from '../lib/cache'
import type { UserResult } from '@shared/types'

/** Creators the signed-in user follows. Paginated grid of creator cards. */
export default function Following(): JSX.Element {
  const nav = useNav()
  const notify = useNotify()

  const [authed, setAuthed] = useState<boolean | null>(null)
  const [creators, setCreators] = useState<UserResult[]>(() => readCache<UserResult[]>('following') ?? [])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pageRef = useRef(1)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    window.api
      .authStatus()
      .then((s) => {
        if (!cancelled) setAuthed(s.authenticated)
      })
      .catch(() => {
        if (!cancelled) setAuthed(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return
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
        <EmptyState
          message="Sign in to see this"
          hint="Your followed creators live behind your RedGifs account."
          action={
            <button className="btn btn-ember" onClick={() => window.api.login()}>
              Sign in
            </button>
          }
        />
      </div>
    )
  }

  const empty = authed === true && creators.length === 0 && !loading && !error

  return (
    <div className="page">
      <PageHeader kicker="following" kickerIndex={3} title="Following" />

      {error && <EmptyState message="Couldn't load following" hint={error} />}
      {empty && (
        <EmptyState
          message="You’re not following anyone yet"
          hint="Follow creators on RedGifs and they’ll show up here."
        />
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
            <CreatorCard
              key={u.username}
              user={u}
              onOpen={() => nav.navigate({ name: 'creator', username: u.username })}
            />
          ))}
        </div>
      )}

      {authed === true && hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
      {loading && creators.length > 0 && (
        <div
          style={{
            textAlign: 'center',
            marginTop: 20,
            fontFamily: 'Space Mono, monospace',
            fontSize: 12,
            color: 'var(--dim)'
          }}
        >
          Loading…
        </div>
      )}
    </div>
  )
}

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
        font: 'inherit',
        transition: 'border-color 120ms ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--ember)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--line)'
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
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
        {initial}
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
      <div
        style={{
          fontFamily: 'Space Mono, monospace',
          fontSize: 11,
          color: 'var(--mut)',
          letterSpacing: '0.02em'
        }}
      >
        {formatCount(user.followers)} followers · {formatCount(user.gifs)} gifs
      </div>
    </button>
  )
}
