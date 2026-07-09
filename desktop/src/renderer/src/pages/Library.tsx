import { useCallback, useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/PageHeader'
import ViewToggle from '../components/ViewToggle'
import QualityToggle from '../components/QualityToggle'
import FeedGrid from '../components/FeedGrid'
import EmptyState from '../components/EmptyState'
import FeedState from '../components/FeedState'
import { useViewMode } from '../hooks/useViewMode'
import { usePlayer } from '../player/PlayerProvider'
import { useBlockedTags } from '../context/blockedTags'
import { useNotify } from '../context/notify'
import { useQuality } from '../context/quality'
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
  const { quality } = useQuality()
  const [mode, setMode] = useViewMode('library', 'grid')

  const [collections, setCollections] = useState<Collection[]>(
    () => readCache<Collection[]>('library:collections') ?? []
  )
  const [source, setSource] = useState<SourceSel>('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [query, setQuery] = useState('')

  const [all, setAll] = useState<Content[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<LibraryProgress | null>(null)

  // Load the collection list for the source picker (cache-first).
  useEffect(() => {
    window.api
      .getCollections()
      .then((list) => {
        setCollections(list)
        writeCache('library:collections', list)
      })
      // The source-picker list failing is independent of the cached content —
      // don't route it into the content error state (it would hide the
      // "index your library" onboarding and blank the grid).
      .catch(() => undefined)
  }, [])

  // Pull the cached gifs matching the current source out of local storage.
  const reload = useCallback((): void => {
    setLoading(true)
    setError(null)
    const filter =
      source === 'all'
        ? {}
        : source === 'liked'
          ? { likedOnly: true }
          : { sources: [{ type: 'collection' as const, id: source }] }
    window.api
      .searchCache(filter)
      .then((rows) => setAll(rows))
      // Clear the rows too, so a failed reload surfaces the error instead of
      // leaving the previous source's stale results on screen.
      .catch((e) => {
        setAll([])
        setError(e instanceof Error ? e.message : String(e))
      })
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
      .downloadContents([c], c.username, quality)
      .then(() => notify('Saving @' + c.username, 'success'))
      .catch((e) => notify('Download failed: ' + e.message, 'error'))
  }

  // Genuinely unindexed: nothing cached at all, no error, done loading.
  const unindexed = !loading && !error && all.length === 0

  return (
    <div className="page">
      <PageHeader
        kicker="library"
        kickerIndex={9}
        title="All media"
        right={
          <div className="controls">
            <QualityToggle />
            <ViewToggle value={mode} onChange={setMode} />
          </div>
        }
      />

      <div className="toolbar">
        <input
          className="field-search"
          placeholder="Search cached gifs — name, creator, tag…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="all">All sources</option>
          <option value="liked">Liked</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="select"
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
        <span className="readout">
          {progress
            ? progress.running
              ? `${progress.phase === 'liked' ? 'Liked videos' : `Collections ${progress.collectionsDone}/${progress.collectionsTotal}`} · ${progress.gifsCached} cached${progress.currentLabel ? ` · ${progress.currentLabel}` : ''}`
              : `Indexed ${progress.gifsCached} gifs`
            : `${results.length} ${results.length === 1 ? 'result' : 'results'}${source !== 'all' ? ' in this source' : ''}`}
        </span>
      </div>

      {unindexed ? (
        <EmptyState
          message="Nothing indexed yet"
          hint="Run a reindex to cache metadata for every gif in your collections and likes — then search and sort across your whole library, offline."
          action={
            <button className="btn btn-ember" onClick={reindex} disabled={running}>
              {running ? 'Indexing…' : 'Index my library'}
            </button>
          }
        />
      ) : (
        <>
          <FeedState
            loading={loading}
            error={error}
            isEmpty={results.length === 0}
            emptyMessage="No matches"
            emptyHint="Try a different search or source."
            onRetry={reload}
          />
          {results.length > 0 && (
            <FeedGrid items={results} mode={mode} onOpen={open} onDownload={download} />
          )}
        </>
      )}
    </div>
  )
}
