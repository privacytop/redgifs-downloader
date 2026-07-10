import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import { usePlayer } from '../player/PlayerProvider'
import MediaGrid from '../components/MediaGrid'
import { useToast } from '../context/toast'
import { formatCount } from '../lib/format'
import type { Content, Niche, UserResult } from '@redloader/core'

/**
 * Search results for a query taken from the route (/search/:query). Three
 * sections stacked top to bottom: matching Creators, matching Niches, then a
 * paged Media grid wired to the swipe player. Creators/Niches only render when
 * they have hits; the media feed is the main event and always shown.
 */
export default function Search(): React.JSX.Element {
  const params = useParams()
  const query = decodeURIComponent(params.query ?? '')
  const navigate = useNavigate()
  const player = usePlayer()
  const notify = useToast()

  const [creators, setCreators] = useState<UserResult[]>([])
  const [niches, setNiches] = useState<Niche[]>([])

  const feed = usePagedFeed(
    (p) => api.searchGifs({ search: query, order: 'latest', page: p }),
    [query]
  )

  useEffect(() => {
    let alive = true
    setCreators([])
    setNiches([])
    if (!query) return
    api
      .searchUsers(query)
      .then((r) => {
        if (alive) setCreators(r.slice(0, 6))
      })
      .catch((e) => notify(e instanceof Error ? e.message : String(e), 'error'))
    api
      .searchNiches(query)
      .then((r) => {
        if (alive) setNiches(r.slice(0, 6))
      })
      .catch((e) => notify(e instanceof Error ? e.message : String(e), 'error'))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const open = (_c: Content, index: number): void => {
    player.open({ items: feed.items, index, label: `"${query}"`, loadMore: feed.loadMoreItems })
  }

  return (
    <div className="page">
      <div className="kicker">Search</div>
      <h1 className="title">{query || 'Search'}</h1>

      {creators.length > 0 && (
        <>
          <div className="section-label">Creators</div>
          {creators.map((u) => (
            <div
              key={u.username}
              className="creator"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/creator/${encodeURIComponent(u.username)}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') navigate(`/creator/${encodeURIComponent(u.username)}`)
              }}
            >
              <div className="avatar">
                {u.profileImageUrl ? (
                  <img src={u.profileImageUrl} alt="" />
                ) : (
                  (u.name || u.username || '?').charAt(0).toUpperCase()
                )}
              </div>
              <div className="creator-info">
                <div className="creator-name">@{u.username}</div>
                <div className="creator-sub">
                  {formatCount(u.followers)} followers · {formatCount(u.gifs)} gifs
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {niches.length > 0 && (
        <>
          <div className="section-label">Niches</div>
          <div className="chip-row">
            {niches.map((n) => (
              <button
                key={n.id}
                className="chip"
                onClick={() => navigate(`/niche/${encodeURIComponent(n.id)}`, { state: { title: n.name } })}
              >
                {n.name}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="section-label">Media</div>
      {feed.error && feed.items.length === 0 ? (
        <div className="empty">
          <div className="empty-msg">Couldn’t load</div>
          <div className="empty-sub">{feed.error}</div>
          <button className="btn" onClick={feed.reload}>Try again</button>
        </div>
      ) : !feed.loading && feed.items.length === 0 ? (
        <div className="empty">
          <div className="empty-msg">No results for “{query}”</div>
          <div className="empty-sub">Try a different search term.</div>
        </div>
      ) : (
        <MediaGrid
          items={feed.items}
          onOpen={open}
          onEndReached={feed.loadMore}
          hasMore={feed.hasMore}
          loading={feed.loading}
        />
      )}
    </div>
  )
}
