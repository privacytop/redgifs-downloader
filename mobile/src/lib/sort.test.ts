import { describe, expect, it } from 'vitest'
import type { Content } from '@redloader/core'
import { CLIENT_SORTS, CREATOR_SORTS, SEARCH_SORTS, findSort, sortContents } from './sort'

const mk = (id: string, p: Partial<Content>): Content => ({
  id, title: '', description: '', duration: 0, width: 0, height: 0, views: 0, likes: 0,
  username: 'u', createDate: 0, hasAudio: false, urls: {}, tags: [], niches: [], ...p
})

describe('sort options', () => {
  it('server lists only carry orders the endpoint accepts', () => {
    const search = new Set(['top', 'top7', 'top28', 'latest', 'score', 'trending'])
    for (const o of SEARCH_SORTS) expect(search.has(o.order ?? '')).toBe(true)
    const creator = new Set(['trending', 'oldest', 'latest', 'top', 'top7', 'top28'])
    for (const o of CREATOR_SORTS) expect(creator.has(o.order ?? '')).toBe(true)
  })

  it('falls back to the first option for unknown keys', () => {
    expect(findSort(CLIENT_SORTS, 'nope').key).toBe('default')
    expect(findSort(SEARCH_SORTS, 'top7').order).toBe('top7')
  })

  it('client sort is a copy and respects the comparator', () => {
    const items = [mk('a', { views: 1, likes: 9 }), mk('b', { views: 5, likes: 2 })]
    const byViews = sortContents(items, 'views')
    expect(byViews.map((c) => c.id)).toEqual(['b', 'a'])
    expect(items[0].id).toBe('a')
    expect(sortContents(items, undefined)).toBe(items)
  })
})
