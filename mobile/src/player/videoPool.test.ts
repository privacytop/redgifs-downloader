import { describe, expect, it } from 'vitest'
import { updateVideoPool } from './videoPool'

describe('updateVideoPool', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']

  it('keeps the current clip and neighbours resident', () => {
    expect(updateVideoPool(ids, 3, [], 6)).toEqual(['c', 'e', 'd'])
  })

  it('retains recently visited clips while moving through the feed', () => {
    let pool = updateVideoPool(ids, 1, [], 6)
    pool = updateVideoPool(ids, 2, pool, 6)
    pool = updateVideoPool(ids, 3, pool, 6)
    expect(pool).toContain('b')
    expect(pool).toContain('c')
    expect(pool).toContain('d')
  })

  it('evicts the oldest clip without evicting the current clip', () => {
    const pool = updateVideoPool(ids, 5, ['a', 'b', 'c', 'd', 'e', 'f'], 6)
    expect(pool).not.toContain('a')
    expect(pool).toContain('f')
    expect(pool).toEqual(['b', 'c', 'd', 'e', 'g', 'f'])
  })
})
