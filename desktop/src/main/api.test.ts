import { describe, it, expect, vi, afterEach } from 'vitest'
import { RedgifsApi, toContent, toContentResponse } from './api'

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

describe('silent-refresh on 401', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('refreshes once and retries the request when a user token is rejected', async () => {
    const api = new RedgifsApi()
    api.setUserToken('dummy') // non-JWT → treated as non-expiring, so token() makes no network call
    let refreshed = 0
    api.setOnAuthExpired(async () => {
      refreshed++
      return true // pretend a fresh token is now in place
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ gifs: [], page: 1, pages: 1, total: 0 }) })
    vi.stubGlobal('fetch', fetchMock)

    const r = await api.getLikes(1)

    expect(refreshed).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(r.total).toBe(0)
  })

  it('gives up (throws) when the refresh fails', async () => {
    const api = new RedgifsApi()
    api.setUserToken('dummy')
    api.setOnAuthExpired(async () => false)
    const fetchMock = vi.fn().mockResolvedValue({ status: 401, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.getLikes(1)).rejects.toThrow('HTTP 401')
    // One real attempt, one refresh probe → no endless retry loop.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
