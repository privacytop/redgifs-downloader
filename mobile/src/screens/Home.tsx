import { useState } from 'react'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import { useAuth } from '../context/auth'
import Feed from '../components/Feed'
import ScreenHeader from '../components/ScreenHeader'

type Tab = 'trending' | 'for-you'

/**
 * Home: Trending (public) and For you (personal feed, needs sign-in). Each is a
 * sortable feed; For you falls back to a sign-in prompt when signed out.
 */
export default function Home(): React.JSX.Element {
  const { authenticated } = useAuth()
  const [tab, setTab] = useState<Tab>('trending')
  const gatedForYou = tab === 'for-you' && !authenticated

  const feed = usePagedFeed(
    (p) => {
      if (gatedForYou) return Promise.resolve({ contents: [], page: 1, pages: 1, total: 0 })
      return tab === 'trending' ? api.getTrending(p) : api.getForYou(p)
    },
    [tab, authenticated],
    `feed:${tab}`
  )

  return (
    <div className="page">
      <ScreenHeader title={tab === 'trending' ? 'Trending' : 'For you'} />
      <div style={{ margin: '0 0 18px' }}>
        <div className="seg" role="group" aria-label="Feed">
          <button className={tab === 'for-you' ? 'on' : ''} onClick={() => setTab('for-you')}>
            For you
          </button>
          <button className={tab === 'trending' ? 'on' : ''} onClick={() => setTab('trending')}>
            Trending
          </button>
        </div>
      </div>

      {gatedForYou ? (
        <div className="empty">
          <div className="empty-msg">Sign in for your personal feed</div>
          <div className="empty-sub">Your For-you feed needs a RedGifs account. Trending needs no sign-in.</div>
          <button className="btn" onClick={() => setTab('trending')}>Browse Trending</button>
        </div>
      ) : (
        <Feed feed={feed} label={tab === 'trending' ? 'Trending' : 'For you'} emptyMessage="Nothing here yet" />
      )}
    </div>
  )
}
