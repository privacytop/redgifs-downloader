import { describe, it, expect } from 'vitest'
import { toContent, toContentResponse } from './api'

describe('api conversion', () => {
  it('maps a raw gif to Content', () => {
    const c = toContent({
      id: 'g1', createDate: 1, hasAudio: true, width: 1920, height: 1080, likes: 5, views: 9,
      duration: 12, urls: { hd: 'h.mp4', sd: 's.mp4', thumbnail: 't.jpg' }, userName: 'bob',
      description: 'hi', tags: ['a'], niches: []
    } as any)
    expect(c).toMatchObject({ id: 'g1', username: 'bob', hasAudio: true, urls: { hd: 'h.mp4' } })
  })

  it('maps a content response with pagination fields', () => {
    const r = toContentResponse({ gifs: [], page: 2, pages: 5, total: 400 } as any)
    expect(r).toEqual({ contents: [], page: 2, pages: 5, total: 400 })
  })
})
