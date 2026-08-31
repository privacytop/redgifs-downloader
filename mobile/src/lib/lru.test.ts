import { describe, expect, it } from 'vitest'
import { LruCache } from './lru'

describe('LruCache', () => {
  it('evicts the least recently used entry at capacity', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('one', 1)
    cache.set('two', 2)
    expect(cache.get('one')).toBe(1)
    cache.set('three', 3)

    expect(cache.get('two')).toBeUndefined()
    expect(cache.get('one')).toBe(1)
    expect(cache.get('three')).toBe(3)
    expect(cache.size).toBe(2)
  })

  it('updates an existing key without evicting another entry', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('one', 1)
    cache.set('two', 2)
    cache.set('one', 10)

    expect(cache.get('one')).toBe(10)
    expect(cache.get('two')).toBe(2)
  })

  it('rejects invalid capacities', () => {
    expect(() => new LruCache(0)).toThrow('positive integer')
  })
})
