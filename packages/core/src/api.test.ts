import { describe, it, expect, vi, afterEach } from 'vitest'
import { ApiError, RedgifsApi, toContent, toContentResponse } from './api'

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

  it('refreshes at most once per request even if the server keeps rejecting', async () => {
    const api = new RedgifsApi()
    api.setUserToken('dummy')
    let refreshed = 0
    api.setOnAuthExpired(async () => {
      refreshed++
      return true
    })
    const fetchMock = vi.fn().mockResolvedValue({ status: 401, json: async () => ({}), text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.getLikes(1)).rejects.toBeInstanceOf(ApiError)
    expect(refreshed).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('errors and tokens', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("surfaces the server's own message and code", async () => {
    const api = new RedgifsApi()
    api.setUserToken('dummy')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 400,
        json: async () => ({}),
        text: async () => JSON.stringify({ error: { code: 'BadOrder', message: 'Bad sorting order "x"', status: 400 } })
      })
    )
    const err = await api.searchGifs({ order: 'x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe('BadOrder')
    expect((err as ApiError).message).toContain('Bad sorting order')
    expect((err as ApiError).status).toBe(400)
  })

  it('fetches the anonymous token once for concurrent requests', async () => {
    const api = new RedgifsApi()
    const fetchMock = vi.fn(async (url: URL) => {
      if (String(url).includes('/auth/temporary')) return { status: 200, json: async () => ({ token: 'anon' }) }
      return { status: 200, json: async () => ({ gifs: [], page: 1, pages: 1, total: 0 }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    await Promise.all([api.getTrending(1), api.getTrending(2), api.getTrending(3)])
    const tokenCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/auth/temporary'))
    expect(tokenCalls).toHaveLength(1)
  })

  it('backs off on 429 using the hinted delay and then succeeds', async () => {
    const api = new RedgifsApi()
    api.setUserToken('dummy')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 429, json: async () => ({ error: { delay: 0.05 } }), headers: { get: () => null } })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ gifs: [], page: 1, pages: 1, total: 0 }) })
    vi.stubGlobal('fetch', fetchMock)
    const t0 = Date.now()
    await api.getLikes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(40)
  })
})
