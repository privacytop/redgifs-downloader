import type { Content, ContentResponse, LibraryProgress } from './types'

// Safety cap so a mis-reported `pages` count can never loop forever.
const MAX_PAGES = 500
// Page size every list endpoint is asked for; a full page with no `pages`
// field means "there may be more".
const PAGE_SIZE = 80

/** The minimal API surface the indexer walks. */
export interface IndexApi {
  getCollections(): Promise<Array<{ id: string; name: string }>>
  getCollectionContent(id: string, page: number): Promise<ContentResponse>
  getLikes(page: number): Promise<ContentResponse>
}

/**
 * The minimal storage surface the indexer writes to. `cacheContents` may be
 * sync (desktop better-sqlite3) or async (mobile Capacitor sqlite) — the
 * indexer awaits it either way, so both platforms share this walk.
 */
export interface IndexStore {
  cacheContents(
    contents: Content[],
    source: { type: 'collection' | 'liked'; id: string }
  ): void | Promise<void>
}

export interface IndexOptions {
  /** Attempts per page before that source is marked failed (default 3). */
  retries?: number
  /** Pause between attempts, multiplied by the attempt number (default 800ms). */
  retryDelayMs?: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function withRetry<T>(fn: () => Promise<T>, retries: number, delayMs: number): Promise<T> {
  let last: unknown
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (i < retries - 1 && delayMs > 0) await sleep(delayMs * (i + 1))
    }
  }
  throw last
}

/**
 * Walk every collection the signed-in user owns plus their liked videos,
 * paging through each and caching the gif metadata (id, username, tags, urls,
 * counts — everything except the media file itself) into local storage so the
 * whole library becomes searchable/sortable offline.
 *
 * Each page is retried before a source is given up on; a source that still
 * fails is skipped (what was cached is kept) AND reported in `failed`, so the
 * UI can say the index is partial instead of silently claiming success.
 * Progress is reported after every page via `onProgress`.
 */
export async function indexLibrary(
  api: IndexApi,
  storage: IndexStore,
  onProgress: (p: LibraryProgress) => void,
  opts: IndexOptions = {}
): Promise<LibraryProgress> {
  const retries = opts.retries ?? 3
  const retryDelayMs = opts.retryDelayMs ?? 800
  let gifsCached = 0
  const failed: string[] = []

  const emit = (
    phase: LibraryProgress['phase'],
    collectionsDone: number,
    collectionsTotal: number,
    currentLabel: string,
    running: boolean
  ): LibraryProgress => {
    const p: LibraryProgress = {
      phase,
      collectionsDone,
      collectionsTotal,
      gifsCached,
      currentLabel,
      running,
      failed: [...failed]
    }
    onProgress(p)
    return p
  }

  const more = (res: ContentResponse, page: number, got: number): boolean =>
    res.pages ? page < res.pages : got >= PAGE_SIZE

  // ---- phase 1: collections ----
  let collections: { id: string; name: string }[] = []
  try {
    collections = await withRetry(() => api.getCollections(), retries, retryDelayMs)
  } catch {
    collections = []
    failed.push('Collections list')
  }
  const total = collections.length
  let done = 0

  for (const col of collections) {
    emit('collections', done, total, col.name, true)
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await withRetry(() => api.getCollectionContent(col.id, page), retries, retryDelayMs)
        const items = res.contents ?? []
        if (items.length) {
          await storage.cacheContents(items, { type: 'collection', id: col.id })
          gifsCached += items.length
        }
        emit('collections', done, total, col.name, true)
        if (!more(res, page, items.length)) break
      }
    } catch {
      // Skip this collection; keep indexing the rest — but say so.
      failed.push(col.name)
    }
    done++
    emit('collections', done, total, col.name, true)
  }

  // ---- phase 2: liked videos ----
  emit('liked', done, total, 'Liked videos', true)
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await withRetry(() => api.getLikes(page), retries, retryDelayMs)
      const items = res.contents ?? []
      if (items.length) {
        await storage.cacheContents(items, { type: 'liked', id: 'liked' })
        gifsCached += items.length
      }
      emit('liked', done, total, 'Liked videos', true)
      if (!more(res, page, items.length)) break
    }
  } catch {
    // Liked feed unavailable (e.g. not signed in) — keep what we have.
    failed.push('Liked videos')
  }

  return emit('done', done, total, '', false)
}
