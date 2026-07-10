import type { Content, ContentResponse, LibraryProgress } from './types'

// Safety cap so a mis-reported `pages` count can never loop forever.
const MAX_PAGES = 500

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

/**
 * Walk every collection the signed-in user owns plus their liked videos,
 * paging through each and caching the gif metadata (id, username, tags, urls,
 * counts — everything except the media file itself) into local storage so the
 * whole library becomes searchable/sortable offline.
 *
 * A failure fetching one collection (or the liked feed) is swallowed so the
 * rest of the library still gets indexed; anything already cached is kept.
 * Progress is reported after every page via `onProgress`.
 */
export async function indexLibrary(
  api: IndexApi,
  storage: IndexStore,
  onProgress: (p: LibraryProgress) => void
): Promise<LibraryProgress> {
  let gifsCached = 0

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
      running
    }
    onProgress(p)
    return p
  }

  // ---- phase 1: collections ----
  let collections: { id: string; name: string }[] = []
  try {
    collections = await api.getCollections()
  } catch {
    collections = []
  }
  const total = collections.length
  let done = 0

  for (const col of collections) {
    emit('collections', done, total, col.name, true)
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await api.getCollectionContent(col.id, page)
        const items = res.contents ?? []
        if (items.length) {
          await storage.cacheContents(items, { type: 'collection', id: col.id })
          gifsCached += items.length
        }
        emit('collections', done, total, col.name, true)
        if (!res.pages || page >= res.pages) break
      }
    } catch {
      // Skip this collection; keep indexing the rest.
    }
    done++
    emit('collections', done, total, col.name, true)
  }

  // ---- phase 2: liked videos ----
  emit('liked', done, total, 'Liked videos', true)
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await api.getLikes(page)
      const items = res.contents ?? []
      if (items.length) {
        await storage.cacheContents(items, { type: 'liked', id: 'liked' })
        gifsCached += items.length
      }
      emit('liked', done, total, 'Liked videos', true)
      if (!res.pages || page >= res.pages) break
    }
  } catch {
    // Liked feed unavailable (e.g. not signed in) — keep what we have.
  }

  return emit('done', done, total, '', false)
}
