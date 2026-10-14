import { useEffect, useState } from 'react'
import { useNavigate, useParams } from '../nav'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import Feed from '../components/Feed'
import ScreenHeader from '../components/ScreenHeader'
import { useToast } from '../context/toast'
import { formatCount } from '../lib/format'
import { TEXT_SEARCH_SORTS, findSort } from '../lib/sort'
import type { Niche, UserResult } from '@redloader/core'
import { CachedImage } from '../components/CachedMedia'

/**
 * Search results for a query (/search/:query). Three sections stacked top to
 * bottom: matching Creators, matching Niches, then a paged Media grid wired to
 * the swipe player. The media sort is a real server order (relevance by
 * default, like the site).
 */
export default function Search(): React.JSX.Element {
  const { query = '' } = useParams<{ query: string }>()
  const navigate = useNavigate()
  const notify = useToast()

  const [creators, setCreators] = useState<UserResult[]>([])
  const [niches, setNiches] = useState<Niche[]>([])
  const [sort, setSort] = useState('score')
  const order = findSort(TEXT_SEARCH_SORTS, sort).order ?? 'score'

  const feed = usePagedFeed(
    (p) => api.searchGifs({ search: query, order, page: p }),
    [query, order],
    `feed:search:${order}:${query}`
  )

  useEffect(() => {
    let alive = true
    setCreators([])
    setNiches([])
    if (!query) return
    let warned = false
    const warn = (e: unknown): void => {
      if (!alive || warned) return
      warned = true
      notify('Some results couldn’t load: ' + (e instanceof Error ? e.message : String(e)), 'warning')
    }
    api
      .searchUsers(query)
      .then((r) => {
        if (alive) setCreators(r.slice(0, 6))
      })
      .catch(warn)
    api
      .searchNiches(query)
      .then((r) => {
        if (alive) setNiches(r.slice(0, 6))
      })
      .catch(warn)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  return (
    <div className="page">
      <ScreenHeader title={query || 'Search'} back />

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
                  <CachedImage
                    cacheKey={`creator:${u.username}`}
                    src={u.profileImageUrl}
                    alt=""
                  />
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

      <div style={{ height: 22 }} />
      <Feed
        feed={feed}
        label={`"${query}"`}
        emptyMessage={`No results for “${query}”`}
        emptyHint="Try a different search term."
        sorts={TEXT_SEARCH_SORTS}
        sort={sort}
        onSortChange={setSort}
        toolbarLeft={
          <div className="section-label" style={{ margin: 0 }}>
            Media{feed.total ? ` · ${formatCount(feed.total)}` : ''}
          </div>
        }
      />
    </div>
  )
}
