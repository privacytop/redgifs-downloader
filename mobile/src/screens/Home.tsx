import { useState } from 'react'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import { usePlayer } from '../player/PlayerProvider'
import MediaGrid from '../components/MediaGrid'
import type { Content } from '@redloader/core'

type Tab = 'trending' | 'for-you'

/**
 * Home: Trending (public) and For you (needs sign-in — phase 3). For now the
 * For-you tab shows a sign-in prompt; Trending is fully browsable anonymously.
 */
export default function Home(): React.JSX.Element {
  const player = usePlayer()
  const [tab, setTab] = useState<Tab>('trending')

  const feed = usePagedFeed((p) => api.getTrending(p), [tab], `feed:${tab}`)

  const open = (_c: Content, index: number): void => {
    player.open({ items: feed.items, index, label: 'Trending', loadMore: feed.loadMoreItems })
  }

  return (
    <div className="page">
      <h1 className="title">{tab === 'trending' ? 'Trending' : 'For you'}</h1>
      <div style={{ margin: '12px 0 18px' }}>
        <div className="seg" role="group" aria-label="Feed">
          <button className={tab === 'for-you' ? 'on' : ''} onClick={() => setTab('for-you')}>
            For you
          </button>
          <button className={tab === 'trending' ? 'on' : ''} onClick={() => setTab('trending')}>
            Trending
          </button>
        </div>
      </div>

      {tab === 'for-you' ? (
        <div className="empty">
          <div className="empty-msg">Sign in for your personal feed</div>
          <div className="empty-sub">Your For-you feed needs a RedGifs account. Trending needs no sign-in.</div>
          <button className="btn" onClick={() => setTab('trending')}>Browse Trending</button>
        </div>
      ) : feed.error && feed.items.length === 0 ? (
        <div className="empty">
          <div className="empty-msg">Couldn’t load</div>
          <div className="empty-sub">{feed.error}</div>
          <button className="btn" onClick={feed.reload}>Try again</button>
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
