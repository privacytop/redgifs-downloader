import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import PageHeader from '../components/PageHeader'
import ViewToggle from '../components/ViewToggle'
import FeedGrid from '../components/FeedGrid'
import EmptyState from '../components/EmptyState'
import { useViewMode } from '../hooks/useViewMode'
import { usePlayer } from '../player/PlayerProvider'
import { useBlockedTags } from '../context/blockedTags'
import { useNotify } from '../context/notify'
import { readCache, writeCache } from '../lib/cache'
import type { Collection, Content, LibraryProgress } from '@shared/types'

type SourceSel = 'all' | 'liked' | string // string = collection id
type SortKey = 'recent' | 'likes' | 'views' | 'duration' | 'az'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Newest' },
  { key: 'likes', label: 'Most liked' },
  { key: 'views', label: 'Most viewed' },
  { key: 'duration', label: 'Longest' },
  { key: 'az', label: 'Creator A–Z' }
]

const comparators: Record<SortKey, (a: Content, b: Content) => number> = {
  recent: (a, b) => b.createDate - a.createDate,
  likes: (a, b) => b.likes - a.likes,
  views: (a, b) => b.views - a.views,
  duration: (a, b) => (b.duration || 0) - (a.duration || 0),
  az: (a, b) => a.username.localeCompare(b.username)
}

/**
 * Library → the local, offline-searchable index of every gif cached from the
 * user's collections and liked videos. A "Reindex" pass walks the whole library
 * via the RedGifs API and stores metadata; this page then searches/sorts across
 * all of it instantly, with no network per query.
 */
export default function Library(): JSX.Element {
  const notify = useNotify()
  const player = usePlayer()
  const { isBlocked } = useBlockedTags()
  const [mode, setMode] = useViewMode('library', 'grid')

  const [collections, setCollections] = useState<Collection[]>(
    () => readCache<Collection[]>('library:collections') ?? []
  )
  const [source, setSource] = useState<SourceSel>('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [query, setQuery] = useState('')

  const [all, setAll] = useState<Content[]>([])
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState<LibraryProgress | null>(null)

  // Load the collection list for the source picker (cache-first).
  useEffect(() => {
    window.api
      .getCollections()
      .then((list) => {
        setCollections(list)
        writeCache('library:collections', list)
      })
      .catch(() => undefined)
  }, [])

  // Pull the cached gifs matching the current source out of local storage.
  const reload = useCallback((): void => {
    setLoading(true)
    const filter =
      source === 'all'
        ? {}
        : source === 'liked'
          ? { likedOnly: true }
          : { sources: [{ type: 'collection' as const, id: source }] }
    window.api
      .searchCache(filter)
      .then((rows) => setAll(rows))
      .catch(() => setAll([]))
      .finally(() => setLoading(false))
  }, [source])

  useEffect(() => reload(), [reload])

  // Live progress while a reindex runs.
  useEffect(() => {
    return window.api.on('evt:library:progress', (p) => setProgress(p))
  }, [])

  const running = progress?.running ?? false

  const reindex = (): void => {
    if (running) return
    setProgress({
      phase: 'collections',
      collectionsDone: 0,
      collectionsTotal: 0,
      gifsCached: 0,
      currentLabel: 'Starting…',
      running: true
    })
    window.api
      .indexLibrary()
      .then((final) => {
        setProgress(final)
        notify(`Indexed ${final.gifsCached} gifs`, 'success')
        reload()
      })
      .catch((e) => {
        setProgress(null)
        notify('Indexing failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
      })
  }

  // Free-text + blocked-tag filter, then sort. Recomputed only when inputs move.
  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const filtered = all.filter((c) => {
      if (isBlocked(c)) return false
      if (!terms.length) return true
      const hay = (
        c.title +
        ' ' +
        c.description +
        ' ' +
        c.username +
        ' ' +
        (c.tags ?? []).join(' ')
      ).toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
    return filtered.sort(comparators[sort])
  }, [all, query, sort, isBlocked])

  const open = (_c: Content, index: number): void => {
    player.open({ items: results, index, label: 'Library', loadMore: async () => [] })
  }

  const download = (c: Content): void => {
    window.api
      .downloadContents([c], c.username)
      .then(() => notify('Saving @' + c.username, 'success'))
      .catch((e) => notify('Download failed: ' + e.message, 'error'))
  }

  const empty = !loading && all.length === 0
  const noMatch = !loading && all.length > 0 && results.length === 0

  return (
    <div className="page">
      <PageHeader
        kicker="library"
        kickerIndex={9}
        title="All media"
        right={<ViewToggle value={mode} onChange={setMode} />}
      />

      <div style={barStyle}>
        <input
          style={searchStyle}
          placeholder="Search cached gifs — name, creator, tag…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select style={selectStyle} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="all">All sources</option>
          <option value="liked">Liked</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          style={selectStyle}
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <button className="btn btn-ember btn-sm" onClick={reindex} disabled={running}>
          {running ? 'Indexing…' : 'Reindex'}
        </button>
      </div>

      {progress && (
        <div style={progressStyle}>
          {progress.running
            ? `${progress.phase === 'liked' ? 'Liked videos' : `Collections ${progress.collectionsDone}/${progress.collectionsTotal}`} · ${progress.gifsCached} cached${progress.currentLabel ? ` · ${progress.currentLabel}` : ''}`
            : `Indexed ${progress.gifsCached} gifs.`}
        </div>
      )}

      {!empty && !noMatch && (
        <div style={countStyle}>
          {results.length} {results.length === 1 ? 'result' : 'results'}
          {source !== 'all' && ' in this source'}
        </div>
      )}

      {empty ? (
        <EmptyState
          message="Nothing indexed yet"
          hint="Run a reindex to cache metadata for every gif in your collections and likes — then search and sort across your whole library, offline."
          action={
            <button className="btn btn-ember" onClick={reindex} disabled={running}>
              {running ? 'Indexing…' : 'Index my library'}
            </button>
          }
        />
      ) : noMatch ? (
        <EmptyState message="No matches" hint="Try a different search or source." />
      ) : (
        <FeedGrid items={results} mode={mode} onOpen={open} onDownload={download} />
      )}
    </div>
  )
}

const barStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  alignItems: 'center',
  marginBottom: 16
}

const searchStyle: CSSProperties = {
  flex: '1 1 260px',
  minWidth: 0,
  fontSize: 14,
  padding: '9px 12px'
}

const selectStyle: CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 12,
  padding: '8px 10px',
  background: 'var(--panel)',
  color: 'var(--ink)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  maxWidth: 200
}

const progressStyle: CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11.5,
  letterSpacing: '0.03em',
  color: 'var(--ember)',
  marginBottom: 14
}

const countStyle: CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--dim)',
  marginBottom: 14
}
