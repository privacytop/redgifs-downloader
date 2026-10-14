import { useState } from 'react'
import { useNavigate } from '../nav'
import { api } from '../lib/api'
import { useCachedResource } from '../hooks/useCachedResource'
import { usePagedFeed } from '../hooks/usePagedFeed'
import Feed from '../components/Feed'
import ScreenHeader from '../components/ScreenHeader'
import SortMenu from '../components/SortMenu'
import { formatCount } from '../lib/format'
import { SEARCH_SORTS, findSort } from '../lib/sort'
import type { Niche, UserResult } from '@redloader/core'
import SmartSearch from '../components/SmartSearch'
import { CachedImage } from '../components/CachedMedia'

const MAX_CREATORS = 12

/**
 * Discover landing: a search box, a "Trending creators" list, a "Niches" chip
 * row, and a browsable gif feed (like the desktop Discover). Creators and
 * niches are cached (stale-while-revalidate); the gif feed's sort is a real
 * server order on /gifs/search.
 */
export default function Discover(): React.JSX.Element {
  const navigate = useNavigate()

  // `order=trending` returns an empty cursor set for creators (gifs/search
  // quirk); `best` populates.
  const creatorsRes = useCachedResource<UserResult[]>('discover:creators', () =>
    api.searchCreators({ order: 'best', page: 1 }).then((r) => r.slice(0, MAX_CREATORS))
  )
  const nichesRes = useCachedResource<Niche[]>('discover:niches', () => api.getNichesTrending())
  const creators = creatorsRes.data ?? []
  const niches = nichesRes.data ?? []

  const [sort, setSort] = useState('latest')
  const order = findSort(SEARCH_SORTS, sort).order ?? 'latest'
  const feed = usePagedFeed((p) => api.searchGifs({ order, page: p }), [order], `feed:discover:${order}`)

  const openCreator = (username: string): void => {
    navigate(`/creator/${encodeURIComponent(username)}`)
  }

  const openNiche = (niche: Niche): void => {
    navigate(`/niche/${encodeURIComponent(niche.id)}`, { state: { title: niche.name } })
  }

  return (
    <div className="page">
      <ScreenHeader title="Discover" />

      <div style={{ margin: '0 0 4px' }}>
        <SmartSearch />
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
                <CachedImage
                  cacheKey={`creator:${c.username}`}
                  src={c.profileImageUrl}
                  alt=""
                  loading="lazy"
                />
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

      <div className="feed-head" style={{ margin: '22px 0 10px' }}>
        <div className="section-label" style={{ margin: 0 }}>Videos</div>
        <SortMenu options={SEARCH_SORTS} value={sort} onChange={setSort} />
      </div>
      <Feed
        feed={feed}
        label="Discover"
        emptyMessage="Nothing to show"
        sorts={SEARCH_SORTS}
        sort={sort}
        onSortChange={setSort}
        hideToolbar
      />
    </div>
  )
}
