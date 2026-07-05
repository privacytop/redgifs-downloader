import { useEffect, useState, type CSSProperties } from 'react'
import PageHeader from '../components/PageHeader'
import FeedGrid from '../components/FeedGrid'
import EmptyState from '../components/EmptyState'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useNav } from '../context/nav'
import { useNotify } from '../context/notify'
import { formatCount } from '../lib/format'
import type { Content, Niche, TagSuggestion, UserResult } from '@shared/types'

/** A single creator result: avatar + @name, click → creator page. */
function CreatorCard({ user, onOpen }: { user: UserResult; onOpen: (u: string) => void }): JSX.Element {
  return (
    <button
      type="button"
      className="creator-card"
      onClick={() => onOpen(user.username)}
      title={`View @${user.username}`}
    >
      <div className="creator-avatar" aria-hidden="true">
        {user.profileImageUrl ? (
          <img src={user.profileImageUrl} alt={'@' + user.username} loading="lazy" />
        ) : (
          <span>{(user.username?.[0] ?? '?').toUpperCase()}</span>
        )}
      </div>
      <div className="creator-info">
        <div className="creator-name">@{user.username}</div>
        <div className="creator-sub">{formatCount(user.followers)} followers</div>
      </div>
    </button>
  )
}

/**
 * Search page — mirrors RedGifs: tag suggestions, matching niches, creators,
 * and a media feed you can flip between videos and images.
 */
export default function Search({ query }: { query: string }): JSX.Element {
  const { navigate } = useNav()
  const notify = useNotify()
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([])
  const [niches, setNiches] = useState<Niche[]>([])
  const [creators, setCreators] = useState<UserResult[]>([])
  const [type, setType] = useState<'g' | 'i'>('g')

  useEffect(() => {
    let alive = true
    const q = query.trim()
    if (!q) {
      setSuggestions([])
      setNiches([])
      setCreators([])
      return
    }
    window.api.searchSuggest(q).then((r) => alive && setSuggestions(r.slice(0, 14))).catch(() => alive && setSuggestions([]))
    window.api.searchNiches(q).then((r) => alive && setNiches(r.slice(0, 8))).catch(() => alive && setNiches([]))
    window.api
      .searchUsers(q)
      .then((r) => alive && setCreators((Array.isArray(r) ? r : []).slice(0, 12)))
      .catch(() => alive && setCreators([]))
    return () => {
      alive = false
    }
  }, [query])

  const feed = usePlayableFeed(
    (p) => window.api.searchGifs({ search: query, type, order: 'score', page: p }),
    `search:${type}:${query}`,
    [query, type]
  )

  const dl = (c: Content): void => {
    window.api
      .downloadContents([c], c.username)
      .then(() => notify('Saving @' + c.username, 'success'))
      .catch((e) => notify('Download failed: ' + (e as Error).message, 'error'))
  }

  const openCreator = (username: string): void => navigate({ name: 'creator', username })
  const openTag = (tag: string): void => navigate({ name: 'tag', tag })
  const openNiche = (n: Niche): void => navigate({ name: 'niche', id: n.id, title: n.name })

  return (
    <div className="page">
      <PageHeader kicker="search" title={query || 'Search'} />

      {suggestions.length > 0 && (
        <section style={{ marginBottom: 26 }}>
          <div className="search-section-label">Tags</div>
          <div style={chipRowStyle}>
            {suggestions.map((s) => (
              <button key={s.text} type="button" style={chipStyle} onClick={() => openTag(s.text)}>
                {s.text}
                <span style={chipCountStyle}>{formatCount(s.gifs)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {niches.length > 0 && (
        <section style={{ marginBottom: 26 }}>
          <div className="search-section-label">Niches</div>
          <div style={nicheRowStyle}>
            {niches.map((n) => (
              <button key={n.id} type="button" style={nicheCardStyle} onClick={() => openNiche(n)}>
                <span style={nicheThumbStyle}>
                  {n.thumbnail && <img src={n.thumbnail} alt="" loading="lazy" style={nicheImgStyle} />}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={nicheNameStyle}>{n.name}</span>
                  <span style={nicheSubStyle}>{formatCount(n.gifs)} gifs</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {creators.length > 0 && (
        <section style={{ marginBottom: 26 }}>
          <div className="search-section-label">Creators</div>
          <div className="creator-row">
            {creators.map((u) => (
              <CreatorCard key={u.username} user={u} onOpen={openCreator} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div style={mediaHeadStyle}>
          <div className="search-section-label" style={{ margin: 0 }}>
            {type === 'g' ? 'Videos' : 'Images'}
          </div>
          <div className="seg">
            <button className={type === 'g' ? 'on' : ''} onClick={() => setType('g')}>
              Videos
            </button>
            <button className={type === 'i' ? 'on' : ''} onClick={() => setType('i')}>
              Images
            </button>
          </div>
        </div>

        {feed.error && <EmptyState message="Couldn't load" hint={feed.error} />}
        {!feed.error && feed.contents.length === 0 && !feed.loading && (
          <EmptyState
            message="No results"
            hint={query ? `Nothing found for "${query}".` : 'Type a query to search.'}
          />
        )}

        <FeedGrid
          items={feed.contents}
          mode="grid"
          onOpen={feed.openAt}
          onDownload={dl}
          onEndReached={feed.loadMore}
          hasMore={feed.hasMore}
          loading={feed.loading}
        />
      </section>
    </div>
  )
}

const chipRowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 }

const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontFamily: 'var(--mono)',
  fontSize: 12,
  letterSpacing: '0.02em',
  color: 'var(--ink)',
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  borderRadius: 999,
  padding: '6px 12px',
  cursor: 'pointer'
}

const chipCountStyle: CSSProperties = { fontSize: 10, color: 'var(--dim)' }

const nicheRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 10
}

const nicheCardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 11,
  textAlign: 'left',
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  padding: 8,
  color: 'var(--ink)',
  cursor: 'pointer'
}

const nicheThumbStyle: CSSProperties = {
  flex: 'none',
  width: 56,
  height: 40,
  borderRadius: 6,
  overflow: 'hidden',
  background: 'var(--bg)',
  border: '1px solid var(--line2)'
}

const nicheImgStyle: CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' }

const nicheNameStyle: CSSProperties = {
  display: 'block',
  fontFamily: 'Fraunces, serif',
  fontSize: 15,
  color: 'var(--cream)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const nicheSubStyle: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--mono)',
  fontSize: 10.5,
  color: 'var(--mut)',
  marginTop: 2
}

const mediaHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 12
}
