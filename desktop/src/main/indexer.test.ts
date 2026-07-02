import { describe, it, expect, vi } from 'vitest'
import { indexLibrary } from './indexer'
import type { RedgifsApi } from './api'
import type { Storage } from './storage'
import type { Content, ContentResponse, LibraryProgress } from '../shared/types'

function gif(id: string): Content {
  return {
    id, title: '', description: '', duration: 0, width: 0, height: 0, views: 0,
    likes: 0, username: 'u', createDate: 0, hasAudio: false, urls: {}, tags: [], niches: []
  }
}
function page(contents: Content[], p: number, pages: number): ContentResponse {
  return { contents, page: p, pages, total: contents.length }
}

describe('indexLibrary', () => {
  it('walks every collection page plus likes and caches each with its source', async () => {
    const cached: { type: string; id: string; ids: string[] }[] = []
    const storage = {
      cacheContents: (c: Content[], src: { type: string; id: string }) =>
        cached.push({ type: src.type, id: src.id, ids: c.map((x) => x.id) })
    } as unknown as Storage

    const api = {
      getCollections: async () => [
        { id: 'c1', name: 'One' },
        { id: 'c2', name: 'Two' }
      ],
      getCollectionContent: async (id: string, p: number) =>
        id === 'c1'
          ? page([gif(`${id}-${p}`)], p, 2) // c1 has two pages
          : page([gif(`${id}-${p}`)], p, 1), // c2 has one
      getLikes: async (p: number) => page([gif(`like-${p}`)], p, 1)
    } as unknown as RedgifsApi

    const events: LibraryProgress[] = []
    const final = await indexLibrary(api, storage, (p) => events.push(p))

    // c1 paged twice, c2 once, likes once → 4 cache writes, 4 gifs.
    expect(cached).toEqual([
      { type: 'collection', id: 'c1', ids: ['c1-1'] },
      { type: 'collection', id: 'c1', ids: ['c1-2'] },
      { type: 'collection', id: 'c2', ids: ['c2-1'] },
      { type: 'liked', id: 'liked', ids: ['like-1'] }
    ])
    expect(final.gifsCached).toBe(4)
    expect(final.phase).toBe('done')
    expect(final.running).toBe(false)
    expect(events.at(-1)).toEqual(final)
  })

  it('skips a failing collection but still indexes likes', async () => {
    const cached: string[] = []
    const storage = {
      cacheContents: (c: Content[], src: { type: string }) =>
        cached.push(`${src.type}:${c.map((x) => x.id).join(',')}`)
    } as unknown as Storage

    const api = {
      getCollections: async () => [{ id: 'bad', name: 'Bad' }],
      getCollectionContent: vi.fn(async () => {
        throw new Error('boom')
      }),
      getLikes: async (p: number) => page([gif(`like-${p}`)], p, 1)
    } as unknown as RedgifsApi

    const final = await indexLibrary(api, storage, () => undefined)

    expect(cached).toEqual(['liked:like-1'])
    expect(final.gifsCached).toBe(1)
    expect(final.running).toBe(false)
  })
})
