import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useToast } from '../context/toast'
import { useCachedResource } from '../hooks/useCachedResource'
import { formatCount } from '../lib/format'
import type { Niche, UserResult } from '@redloader/core'

const MAX_CREATORS = 12

/**
 * Discover landing: a search box, a "Trending creators" list, and a "Niches"
 * chip row. Creators and niches are each cached (stale-while-revalidate) so
 * switching to this tab paints instantly instead of flashing a loader; tapping
 * a creator or niche routes to its own paged detail screen.
 */
export default function Discover(): React.JSX.Element {
  const navigate = useNavigate()
  const notify = useToast()
  const [query, setQuery] = useState('')

  // `order=trending` returns an empty cursor set for creators (gifs/search
  // quirk); `best` populates.
  const creatorsRes = useCachedResource<UserResult[]>('discover:creators', () =>
    api.searchCreators({ order: 'best', page: 1 }).then((r) => r.slice(0, MAX_CREATORS))
  )
  const nichesRes = useCachedResource<Niche[]>('discover:niches', () => api.getNichesTrending())
  const creators = creatorsRes.data ?? []
  const niches = nichesRes.data ?? []

  const submitSearch = (): void => {
    const q = query.trim()
    if (!q) {
      notify('Type something to search', 'warning')
      return
    }
    navigate(`/search/${encodeURIComponent(q)}`)
  }

  const openCreator = (username: string): void => {
    navigate(`/creator/${encodeURIComponent(username)}`)
  }

  const openNiche = (niche: Niche): void => {
    navigate(`/niche/${encodeURIComponent(niche.id)}`, { state: { title: niche.name } })
  }

  return (
    <div className="page">
      <h1 className="title">Discover</h1>

      <div style={{ margin: '14px 0 4px' }}>
        <input
          className="search"
          type="search"
          value={query}
          placeholder="Search creators, tags, videos…"
          aria-label="Search"
          enterKeyHint="search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitSearch()
          }}
        />
      </div>

      <div className="section-label">Trending creators</div>
      {creators.length === 0 && creatorsRes.loading ? (
        <div className="loading">Loading creators…</div>
      ) : creators.length === 0 && creatorsRes.error ? (
        <div className="empty">
          <div className="empty-msg">Couldn’t load creators</div>
          <div className="empty-sub">{creatorsRes.error}</div>
        </div>
      ) : creators.length === 0 ? (
        <div className="empty">
          <div className="empty-msg">No creators yet</div>
        </div>
      ) : (
        creators.map((c) => (
          <div
            key={c.username}
            className="creator"
            role="button"
            tabIndex={0}
            onClick={() => openCreator(c.username)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                openCreator(c.username)
              }
            }}
          >
            <div className="avatar">
              {c.profileImageUrl ? (
                <img src={c.profileImageUrl} alt="" loading="lazy" />
              ) : (
                (c.name || c.username || '?').charAt(0).toUpperCase()
              )}
            </div>
            <div className="creator-info">
              <div className="creator-name">@{c.username}</div>
              <div className="creator-sub">
                {formatCount(c.followers)} followers · {formatCount(c.gifs)} gifs
              </div>
            </div>
          </div>
        ))
      )}

      <div className="section-label">Niches</div>
      {niches.length === 0 && nichesRes.loading ? (
        <div className="loading">Loading niches…</div>
      ) : niches.length === 0 && nichesRes.error ? (
        <div className="empty">
          <div className="empty-msg">Couldn’t load niches</div>
          <div className="empty-sub">{nichesRes.error}</div>
        </div>
      ) : niches.length === 0 ? (
        <div className="empty">
          <div className="empty-msg">No niches yet</div>
        </div>
      ) : (
        <div className="chip-row">
          {niches.map((n) => (
            <button key={n.id} className="chip" onClick={() => openNiche(n)}>
              {n.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
