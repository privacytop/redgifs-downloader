import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import FeedGrid from '../components/FeedGrid'
import FeedControls from '../components/FeedControls'
import FeedState from '../components/FeedState'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useNav } from '../context/nav'
import { useNotify } from '../context/notify'
import { formatCount } from '../lib/format'
import type { ContentType } from '../lib/feedOptions'
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
  const [type, setType] = useState<ContentType>('g')
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
      <PageHeader
        kicker="search"
        title={query || 'Search'}
        right={<FeedControls mode={mode} onModeChange={setMode} type={type} onTypeChange={setType} />}
      />

      {suggestions.length > 0 && (
        <section style={{ marginBottom: 26 }}>
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
        <section style={{ marginBottom: 26 }}>
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
        <section style={{ marginBottom: 26 }}>
          <div className="section-label">Creators</div>
          <div className="creator-row">
            {creators.map((u) => (
              <CreatorCard key={u.username} user={u} onOpen={openCreator} />
            ))}
          </div>
        </section>
      )}

      <section>
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
          onDownload={dl}
          onEndReached={feed.loadMore}
          hasMore={feed.hasMore}
          loading={feed.loading}
        />
      </section>
    </div>
  )
}
