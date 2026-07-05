import { describe, it, expect, afterEach } from 'vitest'
import { SqliteStorage } from './storage'

let s: SqliteStorage
afterEach(() => s?.close())

describe('SqliteStorage', () => {
  it('round-trips settings', () => {
    s = new SqliteStorage(':memory:', { downloadPath: '/tmp/x' })
    expect(s.getSettings().downloadPath).toBe('/tmp/x')
    s.updateSettings({ ...s.getSettings(), maxConcurrentDownloads: 9 })
    expect(s.getSettings().maxConcurrentDownloads).toBe(9)
  })

  it('records downloads, dedupes, and aggregates stats', () => {
    s = new SqliteStorage(':memory:')
    const base = { contentName: 'a', filePath: '/p', fileSize: 100, duration: 1, width: 2,
      height: 3, hasAudio: false, downloadedAt: 1000, thumbnail: '', searchOrder: 'best', rank: 1 }
    s.addRecord({ username: 'bob', contentId: 'g1', ...base })
    expect(s.hasDownloaded('bob', 'g1')).toBe(true)
    expect(s.hasDownloaded('bob', 'g2')).toBe(false)
    const stats = s.getStats()
    expect(stats.totalDownloads).toBe(1)
    expect(stats.totalSize).toBe(100)
    expect(stats.topUsers[0]).toEqual({ username: 'bob', downloads: 1, size: 100 })
  })

  it('dedupes globally when username is empty', () => {
    s = new SqliteStorage(':memory:')
    const base = { contentName: 'a', filePath: '/p', fileSize: 100, duration: 1, width: 2,
      height: 3, hasAudio: false, downloadedAt: 1000, thumbnail: '', searchOrder: 'best', rank: 1 }
    s.addRecord({ username: 'bob', contentId: 'g1', ...base })
    expect(s.hasDownloaded('', 'g1')).toBe(true)
    expect(s.hasDownloaded('', 'g2')).toBe(false)
  })

  it('caches gif membership and removes it', () => {
    s = new SqliteStorage(':memory:')
    const gif = {
      id: 'g1', title: 't', description: 'd', duration: 5, width: 1, height: 2,
      views: 10, likes: 3, username: 'bob', createDate: 100, hasAudio: false,
      urls: {}, tags: ['x'], niches: []
    }
    s.cacheContents([gif], { type: 'collection', id: 'c1' })
    expect(s.gifCollectionIds('g1')).toEqual(['c1'])
    expect(s.searchCachedGifs({ sources: [{ type: 'collection', id: 'c1' }] })).toHaveLength(1)

    s.removeGifMembership('g1', 'collection', 'c1')
    expect(s.gifCollectionIds('g1')).toEqual([])
    expect(s.searchCachedGifs({ sources: [{ type: 'collection', id: 'c1' }] })).toHaveLength(0)

    // add persists the membership (e.g. after adding a gif to a collection)
    s.addGifMembership('g1', 'collection', 'c2')
    expect(s.gifCollectionIds('g1')).toEqual(['c2'])
  })

  it('persists and clears the user token', () => {
    s = new SqliteStorage(':memory:')
    expect(s.getUserToken()).toBeUndefined()
    s.setUserToken('tok')
    expect(s.getUserToken()).toBe('tok')
    s.clearUserToken()
    expect(s.getUserToken()).toBeUndefined()
  })
})
