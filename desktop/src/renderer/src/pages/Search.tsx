import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import FeedGrid from '../components/FeedGrid'
import EmptyState from '../components/EmptyState'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useNav } from '../context/nav'
import { useNotify } from '../context/notify'
import { formatCount } from '../lib/format'
import type { Content, UserResult } from '@shared/types'

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

/** Search page: matching creators (a row of cards) + a gif feed for the query. */
export default function Search({ query }: { query: string }): JSX.Element {
  const { navigate } = useNav()
  const notify = useNotify()
  const [creators, setCreators] = useState<UserResult[]>([])

  useEffect(() => {
    let alive = true
    if (!query.trim()) {
      setCreators([])
      return
    }
    window.api
      .searchUsers(query)
      .then((users) => {
        if (alive) setCreators(Array.isArray(users) ? users.slice(0, 12) : [])
      })
      .catch(() => {
        if (alive) setCreators([])
      })
    return () => {
      alive = false
    }
  }, [query])

  const feed = usePlayableFeed(
    (p) => window.api.searchGifs({ search: query, order: 'latest', page: p }),
    'Search: ' + query,
    [query]
  )

  const dl = (c: Content): void => {
    window.api
      .downloadContents([c], c.username)
      .then(() => notify('Saving @' + c.username, 'success'))
      .catch((e) => notify('Download failed: ' + (e as Error).message, 'error'))
  }

  const openCreator = (username: string): void => navigate({ name: 'creator', username })

  return (
    <div className="page">
      <PageHeader kicker="search" title={query || 'Search'} />

      {creators.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div className="search-section-label">Creators</div>
          <div className="creator-row">
            {creators.map((u) => (
              <CreatorCard key={u.username} user={u} onOpen={openCreator} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="search-section-label">Gifs</div>

        {feed.error && <EmptyState message="Couldn't load" hint={feed.error} />}
        {!feed.error && feed.contents.length === 0 && !feed.loading && (
          <EmptyState
            message="No results"
            hint={query ? 'Nothing found for "' + query + '".' : 'Type a query to search.'}
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
