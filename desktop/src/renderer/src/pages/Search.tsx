import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import FeedGrid from '../components/FeedGrid'
import FeedControls from '../components/FeedControls'
import FeedState from '../components/FeedState'
import CreatorCard from '../components/CreatorCard'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useDownload } from '../hooks/useDownload'
import { useViewMode } from '../hooks/useViewMode'
import { useNav } from '../context/nav'
import { formatCount } from '../lib/format'
import { SEARCH_ORDERS, type ContentType, type Order } from '../lib/feedOptions'
import type { Niche, TagSuggestion, UserResult } from '@shared/types'

// tokens.css has no section-spacing utility, so the result blocks share one
// constant to stay on the same 26px rhythm as .page-header.
const sectionGap = { marginBottom: 26 } as const

/**
 * Search page — mirrors RedGifs: tag suggestions, matching niches, creators,
 * and a media feed you can flip between videos and images.
 */
export default function Search({ query }: { query: string }): JSX.Element {
  const { navigate } = useNav()
  const download = useDownload()
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([])
  const [niches, setNiches] = useState<Niche[]>([])
  const [creators, setCreators] = useState<UserResult[]>([])
  const [type, setType] = useState<ContentType>('g')
  // Relevance ranking is search-only, so this page defaults to `score` and
  // offers it via SEARCH_ORDERS on top of the shared set.
  const [order, setOrder] = useState<Order>('score')
  const [mode, setMode] = useViewMode('search', 'grid')

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
    (p) => window.api.searchGifs({ search: query, type, order, page: p }),
    `Search “${query}”`,
    [query, type, order]
  )

  const openCreator = (username: string): void => navigate({ name: 'creator', username })
  const openTag = (tag: string): void => navigate({ name: 'tag', tag })
  const openNiche = (n: Niche): void => navigate({ name: 'niche', id: n.id, title: n.name })

  return (
    <div className="page">
      <PageHeader
        kicker="search"
        title={query || 'Search'}
        right={
          <FeedControls
            mode={mode}
            onModeChange={setMode}
            order={order}
            onOrderChange={setOrder}
            orderOptions={SEARCH_ORDERS}
            type={type}
            onTypeChange={setType}
          />
        }
      />

      {suggestions.length > 0 && (
        <section style={sectionGap}>
          <div className="section-label">Tags</div>
          <div className="chip-row">
            {suggestions.map((s) => (
              <button key={s.text} type="button" className="chip" onClick={() => openTag(s.text)}>
                {s.text}
                <span className="stat-l">{formatCount(s.gifs)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {niches.length > 0 && (
        <section style={sectionGap}>
          <div className="section-label">Niches</div>
          <div className="tile-grid">
            {niches.map((n) => (
              <button key={n.id} type="button" className="tile" onClick={() => openNiche(n)}>
                <span className="tile-cover ar-16-9">
                  {n.thumbnail && <img src={n.thumbnail} alt="" loading="lazy" />}
                </span>
                <span className="tile-title">{n.name}</span>
                <span className="tile-sub">{formatCount(n.gifs)} gifs</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {creators.length > 0 && (
        <section style={sectionGap}>
          <div className="section-label">Creators</div>
          <div className="creator-row">
            {creators.map((u) => (
              <CreatorCard key={u.username} user={u} onOpen={openCreator} />
            ))}
          </div>
        </section>
      )}

      <section style={sectionGap}>
        <div className="section-label">Media</div>
        <FeedState
          loading={feed.loading}
          error={feed.error}
          isEmpty={feed.contents.length === 0}
          emptyMessage="No results"
          emptyHint={query ? `Nothing found for "${query}".` : 'Type a query to search.'}
          onRetry={feed.reload}
        />

        <FeedGrid
          items={feed.contents}
          mode={mode}
          onOpen={feed.openAt}
          onDownload={download}
          onEndReached={feed.loadMore}
          hasMore={feed.hasMore}
          loading={feed.loading}
          error={feed.error}
          onRetry={feed.loadMore}
        />
      </section>
    </div>
  )
}
