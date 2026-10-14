import { describe, expect, it } from 'vitest'
import { LIBRARY_ORDER_BY, buildLibraryWhere, likeEscape } from './libraryQuery'

describe('buildLibraryWhere', () => {
  it('is empty when nothing is filtered', () => {
    expect(buildLibraryWhere({})).toEqual({ where: '', params: [] })
    expect(buildLibraryWhere({ text: '   ', tags: [], minViews: 0 })).toEqual({ where: '', params: [] })
  })

  it('ANDs free-text terms across title, creator and tags', () => {
    const { where, params } = buildLibraryWhere({ text: 'Big cat' })
    expect(where.match(/g\.title LIKE/g)).toHaveLength(2)
    expect(params).toEqual(['%big%', '%big%', '%big%', '%cat%', '%cat%', '%cat%'])
  })

  it('escapes LIKE wildcards in search terms', () => {
    expect(likeEscape('50%_off\\')).toBe('50\\%\\_off\\\\')
    expect(buildLibraryWhere({ text: '100%' }).params[0]).toBe('%100\\%%')
  })

  it('tags: all = one EXISTS per tag, any = one IN list; lowercased + deduped', () => {
    const all = buildLibraryWhere({ tags: ['Blonde', 'blonde', 'Teen'], tagMode: 'all' })
    expect(all.where.match(/t\.tag = \?/g)).toHaveLength(2)
    expect(all.params).toEqual(['blonde', 'teen'])
    const any = buildLibraryWhere({ tags: ['Blonde', 'Teen'], tagMode: 'any' })
    expect(any.where).toContain('t.tag IN (?,?)')
    expect(any.params).toEqual(['blonde', 'teen'])
  })

  it('collections are OR (IN list), liked/creator/minimums are AND', () => {
    const { where, params } = buildLibraryWhere({
      collections: ['c1', 'c2'],
      likedOnly: true,
      creator: ' Some_One ',
      minViews: 10_000,
      minLikes: 100,
      minDuration: 30
    })
    expect(where).toContain("m.source_type = 'collection' AND m.source_id IN (?,?)")
    expect(where).toContain("m.source_type = 'liked'")
    expect(where).toContain('g.username = ? COLLATE NOCASE')
    expect(where).toContain('g.views >= ?')
    expect(where).toContain('g.likes >= ?')
    expect(where).toContain('g.duration >= ?')
    expect(params).toEqual(['c1', 'c2', 'Some_One', 10_000, 100, 30])
    expect(where.split(' AND ').length).toBeGreaterThanOrEqual(6)
  })

  it('blocked tags become a NOT EXISTS over the tag table', () => {
    const { where, params } = buildLibraryWhere({ excludeTags: new Set(['Gore', 'gore']) })
    expect(where).toContain('NOT EXISTS')
    expect(params).toEqual(['gore'])
  })

  it('every sort has a deterministic ORDER BY', () => {
    for (const v of Object.values(LIBRARY_ORDER_BY)) expect(v).toMatch(/g\.\w+ (ASC|DESC)/)
  })
})
