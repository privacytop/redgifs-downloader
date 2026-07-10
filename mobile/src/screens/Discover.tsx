import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useToast } from '../context/toast'
import { formatCount } from '../lib/format'
import type { Niche, UserResult } from '@redloader/core'

const MAX_CREATORS = 12

/**
 * Discover landing: a search box, a "Trending creators" list, and a "Niches"
 * chip row. Creators and niches are each fetched once on mount (not paged) —
 * this screen is a jumping-off point, so tapping a creator or niche routes to
 * its own paged detail screen. Search routes to /search/:query on Enter.
 */
export default function Discover(): React.JSX.Element {
  const navigate = useNavigate()
  const notify = useToast()
  const [query, setQuery] = useState('')

  const [creators, setCreators] = useState<UserResult[]>([])
  const [creatorsLoading, setCreatorsLoading] = useState(true)
  const [creatorsError, setCreatorsError] = useState<string | null>(null)

  const [niches, setNiches] = useState<Niche[]>([])
  const [nichesLoading, setNichesLoading] = useState(true)
  const [nichesError, setNichesError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setCreatorsLoading(true)
    setCreatorsError(null)
    api
      // `order=trending` returns an empty cursor-based set for creators (same
      // quirk as gifs/search); `best` actually populates.
      .searchCreators({ order: 'best', page: 1 })
      .then((rows) => {
        if (alive) setCreators(rows.slice(0, MAX_CREATORS))
      })
      .catch((e: unknown) => {
        if (alive) setCreatorsError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (alive) setCreatorsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    setNichesLoading(true)
    setNichesError(null)
    api
      .getNichesTrending()
      .then((rows) => {
        if (alive) setNiches(rows)
      })
      .catch((e: unknown) => {
        if (alive) setNichesError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (alive) setNichesLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

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
      <div className="kicker">Discover</div>
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
      {creatorsLoading ? (
        <div className="loading">Loading creators…</div>
      ) : creatorsError ? (
        <div className="empty">
          <div className="empty-msg">Couldn’t load creators</div>
          <div className="empty-sub">{creatorsError}</div>
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
      {nichesLoading ? (
        <div className="loading">Loading niches…</div>
      ) : nichesError ? (
        <div className="empty">
          <div className="empty-msg">Couldn’t load niches</div>
          <div className="empty-sub">{nichesError}</div>
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
