import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import { useAuth } from '../context/auth'
import Feed from '../components/Feed'
import ScreenHeader from '../components/ScreenHeader'
import SortMenu from '../components/SortMenu'
import { CLIENT_SORTS, SEARCH_SORTS, findSort } from '../lib/sort'

type Tab = 'trending' | 'for-you'
const TAB_KEY = 'home:tab'
const EMPTY = { contents: [], page: 1, pages: 1, total: 0 }

function readTab(): Tab | null {
  try {
    const v = localStorage.getItem(TAB_KEY)
    return v === 'trending' || v === 'for-you' ? v : null
  } catch {
    return null
  }
}

/**
 * Home: For you (personal feed, needs sign-in) and Trending. For you is the
 * default for a signed-in user; a signed-out user who never picked lands on
 * Trending instead of a sign-in gate. The last explicit choice is remembered.
 *
 * Trending is `gifs/search?order=…` — a real server order over the whole
 * 10,000-item set (the curated /feeds/trending/popular is one page of 100).
 * For you has no server order, so its sorts are client-side over all pages.
 */
export default function Home(): React.JSX.Element {
  const { authenticated, ready } = useAuth()
  const [tab, setTab] = useState<Tab>(() => readTab() ?? 'for-you')
  const picked = useRef(readTab() !== null)
  const [trendSort, setTrendSort] = useState('trending')
  const [fySort, setFySort] = useState('default')

  useEffect(() => {
    if (!ready || picked.current) return
    setTab(authenticated ? 'for-you' : 'trending')
  }, [ready, authenticated])

  const choose = (t: Tab): void => {
    picked.current = true
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      /* non-fatal */
    }
    setTab(t)
  }

  const trendOrder = findSort(SEARCH_SORTS, trendSort).order ?? 'trending'
  const gatedForYou = tab === 'for-you' && !authenticated

  const feed = usePagedFeed(
    (p) => {
      if (gatedForYou) return Promise.resolve(EMPTY)
      return tab === 'trending' ? api.getTrending(p, trendOrder) : api.getForYou(p)
    },
    [tab, authenticated, trendOrder],
    tab === 'trending' ? `feed:trending:${trendOrder}` : 'feed:for-you'
  )

  const isTrending = tab === 'trending'

  return (
    <div className="page">
      <ScreenHeader title={isTrending ? 'Trending' : 'For you'} />
      <div className="feed-head" style={{ margin: '0 0 18px' }}>
        <div className="seg" role="group" aria-label="Feed">
          <button className={!isTrending ? 'on' : ''} onClick={() => choose('for-you')}>
            For you
          </button>
          <button className={isTrending ? 'on' : ''} onClick={() => choose('trending')}>
            Trending
          </button>
        </div>
        {!gatedForYou &&
          (isTrending ? (
            <SortMenu options={SEARCH_SORTS} value={trendSort} onChange={setTrendSort} />
          ) : (
            <SortMenu options={CLIENT_SORTS} value={fySort} onChange={setFySort} />
          ))}
      </div>

      {!ready && !isTrending ? (
        <div className="loading">Loading…</div>
      ) : gatedForYou ? (
        <div className="empty">
          <div className="empty-msg">Sign in for your personal feed</div>
          <div className="empty-sub">Your For-you feed needs a RedGifs account. Trending needs no sign-in.</div>
          <button className="btn" onClick={() => choose('trending')}>Browse Trending</button>
        </div>
      ) : (
        <Feed
          feed={feed}
          label={isTrending ? 'Trending' : 'For you'}
          emptyMessage="Nothing here yet"
          sorts={isTrending ? SEARCH_SORTS : CLIENT_SORTS}
          sort={isTrending ? trendSort : fySort}
          onSortChange={isTrending ? setTrendSort : setFySort}
          hideToolbar
        />
      )}
    </div>
  )
}
