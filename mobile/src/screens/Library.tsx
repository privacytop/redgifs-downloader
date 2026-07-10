import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { indexLibrary, type Collection, type Content, type LibraryProgress } from '@redloader/core'
import { api } from '../lib/api'
import { storage } from '../lib/storage'
import { useAuth } from '../context/auth'
import { useToast } from '../context/toast'
import { usePlayer } from '../player/PlayerProvider'
import { usePagedFeed } from '../hooks/usePagedFeed'
import { useCachedResource } from '../hooks/useCachedResource'
import { readCache, writeCache } from '../lib/cache'
import { sortContents, type SortKey } from '../lib/sort'
import Feed from '../components/Feed'
import SortMenu from '../components/SortMenu'
import ScreenHeader from '../components/ScreenHeader'
import MediaGrid from '../components/MediaGrid'
import { formatCount } from '../lib/format'

type View = 'media' | 'collections' | 'likes'
const RENDER_BATCH = 60

/** Library hub: the offline media index, collections, and likes. */
export default function Library(): React.JSX.Element {
  const { authenticated } = useAuth()
  const [view, setView] = useState<View>('media')
  // Keep-alive: a sub-view is mounted the first time it's visited and then kept
  // mounted (just hidden), so switching back is instant with no reload flash.
  const [visited, setVisited] = useState<Set<View>>(new Set(['media']))

  const go = (v: View): void => {
    setView(v)
    setVisited((prev) => (prev.has(v) ? prev : new Set(prev).add(v)))
  }

  return (
    <div className="page">
      <ScreenHeader title="Library" />
      <div style={{ margin: '0 0 18px' }}>
        <div className="seg" role="group" aria-label="Library view">
          <button className={view === 'media' ? 'on' : ''} onClick={() => go('media')}>All media</button>
          <button className={view === 'collections' ? 'on' : ''} onClick={() => go('collections')}>Collections</button>
          <button className={view === 'likes' ? 'on' : ''} onClick={() => go('likes')}>Likes</button>
        </div>
      </div>

      {!authenticated ? (
        <div className="empty">
          <div className="empty-msg">Sign in to use your library</div>
          <div className="empty-sub">Your likes, collections and the offline index need a RedGifs account.</div>
        </div>
      ) : (
        <>
          {visited.has('media') && <div hidden={view !== 'media'}><AllMedia /></div>}
          {visited.has('collections') && <div hidden={view !== 'collections'}><Collections /></div>}
          {visited.has('likes') && <div hidden={view !== 'likes'}><Likes /></div>}
        </>
      )}
    </div>
  )
}

/** The offline metadata index: reindex + local search over cached gifs. */
function AllMedia(): React.JSX.Element {
  const notify = useToast()
  const player = usePlayer()
  const [all, setAll] = useState<Content[]>([])
  const [query, setQuery] = useState('')
  // Seed the count from cache so a return visit shows the real state instantly
  // (no "Nothing indexed yet" flash before the async sqlite read resolves).
  const [count, setCount] = useState<number>(() => readCache<number>('library:count') ?? 0)
  const [loaded, setLoaded] = useState(false)
  const [sort, setSort] = useState<SortKey>('default')
  const [progress, setProgress] = useState<LibraryProgress | null>(null)
  const [visible, setVisible] = useState(RENDER_BATCH)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [rows, n] = await Promise.all([storage.searchCachedGifs({}), storage.cachedCount()])
      setAll(rows)
      setCount(n)
      writeCache('library:count', n)
    } catch (e) {
      notify('Couldn’t read the library: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setLoaded(true)
    }
  }, [notify])

  useEffect(() => {
    void load()
  }, [load])

  const reindex = async (): Promise<void> => {
    if (progress?.running) return
    setProgress({ phase: 'collections', collectionsDone: 0, collectionsTotal: 0, gifsCached: 0, currentLabel: 'Starting…', running: true })
    try {
      await indexLibrary(
        api,
        { cacheContents: (items, src) => storage.cacheContents(items, src) },
        (p) => setProgress(p.running ? p : null)
      )
      setProgress(null)
      await load()
      notify('Library indexed', 'success')
    } catch (e) {
      setProgress(null)
      notify('Indexing failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const filtered = terms.length
      ? all.filter((c) => {
          const hay = (c.title + ' ' + c.description + ' ' + c.username + ' ' + (c.tags ?? []).join(' ')).toLowerCase()
          return terms.every((t) => hay.includes(t))
        })
      : all
    return sortContents(filtered, sort)
  }, [all, query, sort])

  useEffect(() => setVisible(RENDER_BATCH), [query, sort])

  const shown = results.slice(0, visible)
  const running = progress?.running ?? false

  const open = (_c: Content, index: number): void => {
    player.open({ items: results, index, label: 'Library', loadMore: async () => [] })
  }

  // Only show the onboarding once a read has confirmed the index is truly empty
  // — never during the initial async load (that caused the flash).
  if (count === 0 && !running) {
    if (!loaded) return <div className="loading">Loading…</div>
    return (
      <div className="empty">
        <div className="empty-msg">Nothing indexed yet</div>
        <div className="empty-sub">Index caches every gif in your collections and likes so you can search them offline.</div>
        <button className="btn btn-ember" onClick={() => void reindex()}>Index my library</button>
      </div>
    )
  }

  return (
    <>
      <input
        className="search"
        placeholder="Search cached gifs…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0 16px' }}>
        <button className="btn btn-sm" disabled={running} onClick={() => void reindex()}>
          {running ? 'Indexing…' : 'Reindex'}
        </button>
        <span className="readout">
          {running
            ? `${progress?.gifsCached ?? 0} cached · ${progress?.currentLabel ?? ''}`
            : `${formatCount(results.length)} of ${formatCount(count)}`}
        </span>
        <SortMenu value={sort} onChange={setSort} style={{ marginLeft: 'auto' }} />
      </div>
      <MediaGrid
        items={shown}
        onOpen={open}
        onEndReached={() => setVisible((v) => v + RENDER_BATCH)}
        hasMore={visible < results.length}
      />
    </>
  )
}

/** The user's collections as a cover-tile grid (cached, no reload flash). */
function Collections(): React.JSX.Element {
  const navigate = useNavigate()
  const { data, loading } = useCachedResource<Collection[]>('collections', () => api.getCollections())
  const cols = data ?? []

  if (cols.length === 0 && loading) return <div className="loading">Loading…</div>
  if (cols.length === 0) return <div className="empty"><div className="empty-msg">No collections yet</div></div>

  return (
    <div className="tile-grid">
      {cols.map((c) => (
        <button
          key={c.id}
          className="tile"
          style={{ textAlign: 'left', padding: 0, cursor: 'pointer' }}
          onClick={() => navigate(`/collection/${encodeURIComponent(c.id)}`, { state: { title: c.name } })}
        >
          <div className="tile-cover">
            {c.thumbnailUrl ? (
              <img src={c.thumbnailUrl} alt="" loading="lazy" />
            ) : (
              <div className="avatar" style={{ position: 'absolute', inset: 0, borderRadius: 0 }}>
                {(c.name[0] ?? '#').toUpperCase()}
              </div>
            )}
          </div>
          <div className="tile-body">
            <div className="tile-title">{c.name}</div>
            <div className="tile-sub">{formatCount(c.contentCount)} gifs{c.published ? '' : ' · private'}</div>
          </div>
        </button>
      ))}
    </div>
  )
}

/** The user's liked feed. */
function Likes(): React.JSX.Element {
  const feed = usePagedFeed((p) => api.getLikes(p), [], 'feed:likes')
  return <Feed feed={feed} label="Likes" emptyMessage="No likes yet" />
}
