import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '../nav'
import { indexLibrary, type Collection, type Content, type LibraryProgress } from '@redloader/core'
import { api } from '../lib/api'
import { storage, type LibraryQuery, type LibrarySort } from '../lib/storage'
import { useAuth } from '../context/auth'
import { useToast } from '../context/toast'
import { usePlayer } from '../player/PlayerProvider'
import { usePagedFeed } from '../hooks/usePagedFeed'
import { useCachedResource } from '../hooks/useCachedResource'
import { useLibraryQuery } from '../hooks/useLibraryQuery'
import { useDebounced } from '../hooks/useDebounced'
import { readCache, writeCache } from '../lib/cache'
import { getBlockedTags, useBlockedVersion } from '../lib/blockedTags'
import { CLIENT_SORTS, LIBRARY_SORTS } from '../lib/sort'
import Feed from '../components/Feed'
import SortMenu from '../components/SortMenu'
import ScreenHeader from '../components/ScreenHeader'
import MediaGrid from '../components/MediaGrid'
import LibraryFilterSheet, {
  EMPTY_FILTERS,
  countActiveFilters,
  type LibraryFilters
} from '../components/LibraryFilterSheet'
import { formatCount, formatDuration } from '../lib/format'
import { CachedImage } from '../components/CachedMedia'
import { IconSort, IconX } from '../components/icons'

type View = 'media' | 'collections' | 'likes'
const PAGE = 60

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

/**
 * The offline metadata index. Search, filters and sort all run as ONE sqlite
 * statement over the whole index (paged), so "videos with tags A and B inside
 * collection X or Y with ≥10K views, most viewed first" is instant at 10k rows.
 */
function AllMedia(): React.JSX.Element {
  const notify = useToast()
  const player = usePlayer()
  const { username } = useAuth()
  // Seed the count from cache so a return visit shows the real state instantly
  // (no "Nothing indexed yet" flash before the async sqlite read resolves).
  const [count, setCount] = useState<number>(() => readCache<number>('library:count') ?? 0)
  const [loaded, setLoaded] = useState(false)
  const [progress, setProgress] = useState<LibraryProgress | null>(null)

  const [text, setText] = useState('')
  const debouncedText = useDebounced(text, 180)
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS)
  const [sort, setSort] = useState<LibrarySort>('newest')
  const [sheetOpen, setSheetOpen] = useState(false)
  const blockedVersion = useBlockedVersion()

  const collectionsRes = useCachedResource<Collection[]>('collections', () => api.getCollections())
  const collections = useMemo(() => collectionsRes.data ?? [], [collectionsRes.data])
  const collectionName = useCallback(
    (id: string): string => collections.find((c) => c.id === id)?.name ?? 'Collection',
    [collections]
  )

  const query = useMemo<LibraryQuery>(
    () => ({
      text: debouncedText,
      tags: filters.tags,
      tagMode: filters.tagMode,
      collections: filters.collections,
      likedOnly: filters.likedOnly,
      creator: filters.creator,
      minViews: filters.minViews,
      minLikes: filters.minLikes,
      minDuration: filters.minDuration,
      excludeTags: [...getBlockedTags()],
      sort
    }),
    // blockedVersion is the signal that getBlockedTags() changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debouncedText, filters, sort, blockedVersion]
  )
  const result = useLibraryQuery(query, PAGE)

  const refreshCount = useCallback(async (): Promise<void> => {
    try {
      const n = await storage.cachedCount()
      setCount(n)
      writeCache('library:count', n)
    } catch (e) {
      notify('Couldn’t read the library: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setLoaded(true)
    }
  }, [notify])

  useEffect(() => {
    void refreshCount()
  }, [refreshCount])

  const reindex = async (): Promise<void> => {
    if (progress?.running) return
    setProgress({ phase: 'collections', collectionsDone: 0, collectionsTotal: 0, gifsCached: 0, currentLabel: 'Starting…', running: true })
    try {
      const final = await indexLibrary(
        api,
        { cacheContents: (items, src) => storage.cacheContents(items, src) },
        (p) => setProgress(p.running ? p : null)
      )
      setProgress(null)
      if (username) writeCache('library:owner', username)
      await refreshCount()
      result.reload()
      if (final.failed?.length) {
        notify(`Indexed ${formatCount(final.gifsCached)} gifs — couldn’t finish: ${final.failed.join(', ')}`, 'warning')
      } else {
        notify(`Library indexed · ${formatCount(final.gifsCached)} gifs`, 'success')
      }
    } catch (e) {
      setProgress(null)
      notify('Indexing failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }

  const itemsRef = useRef(result.items)
  itemsRef.current = result.items
  const open = useCallback(
    (_c: Content, index: number): void => {
      player.open({ items: itemsRef.current, index, label: 'Library', loadMore: result.loadMoreItems })
    },
    [player, result.loadMoreItems]
  )

  const running = progress?.running ?? false
  const activeFilters = countActiveFilters(filters)

  // Only show the onboarding once a read has confirmed the index is truly empty
  // — never during the initial async load (that caused the flash).
  if (count === 0 && !running) {
    if (!loaded) return <div className="loading">Loading…</div>
    return (
      <div className="empty">
        <div className="empty-msg">Nothing indexed yet</div>
        <div className="empty-sub">Index caches every gif in your collections and likes so you can search, filter and sort them offline.</div>
        <button className="btn btn-ember" onClick={() => void reindex()}>Index my library</button>
      </div>
    )
  }

  const removeFilter = (patch: Partial<LibraryFilters>): void => setFilters({ ...filters, ...patch })

  return (
    <>
      <input
        className="search"
        placeholder="Search title, creator or tag…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="lib-bar">
        <button className="btn btn-sm" disabled={running} onClick={() => void reindex()}>
          {running ? 'Indexing…' : 'Reindex'}
        </button>
        <span className="readout lib-readout">
          {running
            ? `${formatCount(progress?.gifsCached ?? 0)} cached · ${progress?.currentLabel ?? ''}`
            : `${formatCount(result.total)} of ${formatCount(count)}`}
        </span>
        <button
          type="button"
          className={`sortmenu-trigger lib-filter ${activeFilters ? 'on' : ''}`}
          onClick={() => setSheetOpen(true)}
          aria-label="Filters"
        >
          <IconSort className="sortmenu-lead" style={{ transform: 'rotate(90deg)' }} />
          <span className="sortmenu-label">{activeFilters ? `Filters · ${activeFilters}` : 'Filters'}</span>
        </button>
        <SortMenu options={LIBRARY_SORTS} value={sort} onChange={(k) => setSort(k as LibrarySort)} />
      </div>

      {activeFilters > 0 && (
        <div className="chip-row lib-active">
          {filters.likedOnly && (
            <button className="chip on" onClick={() => removeFilter({ likedOnly: false })}>Liked <IconX /></button>
          )}
          {filters.collections.map((id) => (
            <button key={id} className="chip on" onClick={() => removeFilter({ collections: filters.collections.filter((c) => c !== id) })}>
              {collectionName(id)} <IconX />
            </button>
          ))}
          {filters.tags.map((t) => (
            <button key={t} className="chip on" onClick={() => removeFilter({ tags: filters.tags.filter((x) => x !== t) })}>
              #{t} <IconX />
            </button>
          ))}
          {filters.tags.length > 1 && <span className="readout">{filters.tagMode === 'all' ? 'all tags' : 'any tag'}</span>}
          {filters.creator.trim() && (
            <button className="chip on" onClick={() => removeFilter({ creator: '' })}>@{filters.creator.trim()} <IconX /></button>
          )}
          {filters.minViews > 0 && (
            <button className="chip on" onClick={() => removeFilter({ minViews: 0 })}>{formatCount(filters.minViews)}+ views <IconX /></button>
          )}
          {filters.minLikes > 0 && (
            <button className="chip on" onClick={() => removeFilter({ minLikes: 0 })}>{formatCount(filters.minLikes)}+ likes <IconX /></button>
          )}
          {filters.minDuration > 0 && (
            <button className="chip on" onClick={() => removeFilter({ minDuration: 0 })}>{formatDuration(filters.minDuration)}+ <IconX /></button>
          )}
          <button className="chip chip-clear" onClick={() => setFilters(EMPTY_FILTERS)}>Clear all</button>
        </div>
      )}

      {result.error ? (
        <div className="empty">
          <div className="empty-msg">Couldn’t search the library</div>
          <div className="empty-sub">{result.error}</div>
          <button className="btn" onClick={result.reload}>Try again</button>
        </div>
      ) : !result.loading && result.items.length === 0 ? (
        <div className="empty">
          <div className="empty-msg">No matches</div>
          <div className="empty-sub">Loosen a filter or clear the search.</div>
        </div>
      ) : (
        <MediaGrid
          items={result.items}
          onOpen={open}
          onEndReached={result.loadMore}
          hasMore={result.hasMore}
          loading={result.loading && result.items.length > 0}
        />
      )}

      {sheetOpen && (
        <LibraryFilterSheet
          filters={filters}
          onChange={setFilters}
          onClose={() => setSheetOpen(false)}
          collections={collections}
        />
      )}
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
              <CachedImage
                cacheKey={`collection:${c.id}`}
                src={c.thumbnailUrl}
                alt=""
                loading="lazy"
              />
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

/** The user's liked feed (no server order → client sorts over all pages). */
function Likes(): React.JSX.Element {
  const { username } = useAuth()
  const feed = usePagedFeed((p) => api.getLikes(p), [username], `feed:likes:${username ?? ''}`)
  return <Feed feed={feed} label="Likes" emptyMessage="No likes yet" sorts={CLIENT_SORTS} />
}
