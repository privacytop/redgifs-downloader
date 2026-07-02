import type {
  Collection, Content, ContentResponse, Niche, UserProfile, UserResult
} from '../shared/types'
import { RateLimiter } from './ratelimit'
import { decodeJwt } from './jwt'

// Read the `exp` (seconds) claim from a JWT as epoch ms, or 0 if absent.
function expiryFromJwt(token: string): number {
  const exp = decodeJwt(token)?.exp
  return typeof exp === 'number' ? exp * 1000 : 0
}

const BASE = 'https://api.redgifs.com/v2'

interface RawGif {
  id: string; createDate: number; hasAudio: boolean; width: number; height: number
  likes: number; views: number; duration: number; urls: Record<string, string>
  userName: string; description: string; tags: string[]; niches: string[]
}
interface RawContentResponse { gifs: RawGif[]; page: number; pages: number; total: number }

export function toContent(g: RawGif): Content {
  return {
    id: g.id, title: g.description ?? '', description: g.description ?? '',
    duration: g.duration ?? 0, width: g.width ?? 0, height: g.height ?? 0,
    views: g.views ?? 0, likes: g.likes ?? 0, username: g.userName ?? '',
    createDate: g.createDate ?? 0, hasAudio: !!g.hasAudio,
    urls: {
      hd: g.urls?.hd, sd: g.urls?.sd, thumbnail: g.urls?.thumbnail,
      poster: g.urls?.poster, silent: g.urls?.silent
    },
    tags: g.tags ?? [], niches: g.niches ?? []
  }
}

export function toContentResponse(r: RawContentResponse): ContentResponse {
  return { contents: (r.gifs ?? []).map(toContent), page: r.page ?? 1, pages: r.pages ?? 1, total: r.total ?? 0 }
}

export class RedgifsApi {
  private tempToken = ''
  private tempExpiry = 0
  private userToken = ''
  private userExpiry = 0
  private rl = new RateLimiter(120)

  setUserToken(token: string): void {
    this.userToken = token
    this.userExpiry = expiryFromJwt(token)
  }
  clearUserToken(): void {
    this.userToken = ''
    this.userExpiry = 0
  }
  // A user is authenticated only while their token is present and unexpired.
  // (A missing exp claim, userExpiry === 0, is treated as non-expiring.)
  isAuthenticated(): boolean {
    return this.userToken !== '' && (this.userExpiry === 0 || Date.now() < this.userExpiry)
  }

  private async token(): Promise<string> {
    if (this.isAuthenticated()) return this.userToken
    if (this.tempToken && Date.now() < this.tempExpiry) return this.tempToken
    const data = await this.request<{ token: string }>('GET', '/auth/temporary', undefined, false)
    this.tempToken = data.token
    this.tempExpiry = Date.now() + 50 * 60 * 1000
    return this.tempToken
  }

  private async request<T>(method: string, path: string, params?: Record<string, string>, auth = true, body?: unknown): Promise<T> {
    // `path` may be an absolute URL (e.g. the /v1/me endpoint lives on a different
    // API version than the v2 BASE) or a v2-relative path.
    const url = new URL(path.startsWith('http') ? path : BASE + path)
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    for (let attempt = 0; attempt <= 3; attempt++) {
      await this.rl.wait()
      const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'RedGifs-Downloader/4.0' }
      if (auth) headers.Authorization = `Bearer ${await this.token()}`
      const init: RequestInit = { method, headers }
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      const resp = await fetch(url, init)
      if (resp.status === 200) return (await resp.json()) as T
      // Mutation endpoints reply 201/202/204 with an empty (or ignorable) body.
      if (resp.status === 201 || resp.status === 202 || resp.status === 204) return undefined as T
      if (resp.status === 429) {
        const body = await resp.json().catch(() => ({})) as { error?: { delay?: number } }
        this.rl.note429((body.error?.delay ?? 60) * 1000)
        continue
      }
      if (resp.status === 401 && auth && !this.userToken) { this.tempToken = ''; continue }
      if (resp.status === 404) throw new Error(`not found: ${path}`)
      throw new Error(`HTTP ${resp.status} on ${path}`)
    }
    throw new Error(`max retries exceeded on ${path}`)
  }

  async searchUsers(query: string): Promise<UserResult[]> {
    const data = await this.request<{ users: any[] }>('GET', '/users/search', { search_text: query, count: '20' })
    return (data.users ?? []).map(toUserResult)
  }

  async getUserContent(username: string, order: string, page: number): Promise<ContentResponse> {
    const data = await this.request<RawContentResponse>('GET', `/users/${encodeURIComponent(username)}/search`,
      { order, count: '80', page: String(page) })
    return toContentResponse(data)
  }

  async getProfile(): Promise<UserProfile> {
    // The authenticated-user profile lives on the v1 API (v2 has no /me — it 404s).
    const u = await this.request<any>('GET', 'https://api.redgifs.com/v1/me')
    return {
      username: u.username, name: u.name ?? '', profileUrl: u.url ?? u.profileUrl ?? '',
      profilePic: u.profileImageUrl ?? '', followers: u.followers ?? 0, following: u.following ?? 0,
      totalGifs: u.totalGifs ?? u.gifs ?? 0, views: u.views ?? 0, likes: u.likes ?? 0,
      blockedTags: u.blockedTags ?? u.blocked_tags ?? [], preferences: u.preferences ?? []
    }
  }

  async getLikes(page: number): Promise<ContentResponse> {
    return toContentResponse(await this.request<RawContentResponse>('GET', '/feeds/liked',
      { page: String(page), count: '80' }))
  }

  async getCollections(username?: string): Promise<Collection[]> {
    const path = username ? `/users/${encodeURIComponent(username)}/collections` : '/me/collections'
    const data = await this.request<{ collections: any[] }>('GET', path, { count: '100', page: '1' })
    return (data.collections ?? []).map((c) => ({
      id: c.folderId, name: c.folderName ?? '', description: c.description ?? '',
      contentCount: c.contentCount ?? 0, thumbnailUrl: c.thumbs ?? c.thumba ?? c.thumb ?? '',
      published: !!c.published
    }))
  }

  async getCollectionContent(collectionId: string, page: number): Promise<ContentResponse> {
    return toContentResponse(await this.request<RawContentResponse>('GET',
      `/me/collections/${encodeURIComponent(collectionId)}/gifs`, { count: '80', page: String(page) }))
  }

  async getGif(id: string): Promise<Content> {
    const data = await this.request<{ gif: RawGif }>('GET', `/gifs/${encodeURIComponent(id)}`)
    return toContent(data.gif)
  }

  async likeGif(id: string): Promise<void> {
    // The like endpoint requires a body describing where the like came from.
    await this.request<void>('PUT', `/gifs/${encodeURIComponent(id)}/like`, undefined, true, {
      context: null,
      source: 'profile',
      source_id: null,
      position: 0
    })
  }

  async unlikeGif(id: string): Promise<void> {
    await this.request<void>('DELETE', `/gifs/${encodeURIComponent(id)}/like`, undefined, true, {
      context: null,
      source: 'profile',
      source_id: null,
      position: 0
    })
  }

  // ---- feeds ----

  async getForYou(page: number): Promise<ContentResponse> {
    return toContentResponse(await this.request<RawContentResponse>('GET', '/feeds/for-you',
      { page: String(page), count: '80' }))
  }

  // ---- search ----

  async searchGifs(opts: { type?: 'g' | 'i'; order?: string; page?: number; verified?: boolean; tags?: string; search?: string }): Promise<ContentResponse> {
    const params: Record<string, string> = { count: '80' }
    if (opts.type) params.type = opts.type
    // `trending` returns an empty (cursor-based) result set, so default to `latest`.
    params.order = opts.order ?? 'latest'
    if (opts.page) params.page = String(opts.page)
    if (opts.verified) params.verified = 'y'
    // Both map to the `search_text` param; an explicit `search` wins over `tags`.
    if (opts.search) params.search_text = opts.search
    else if (opts.tags) params.search_text = opts.tags
    return toContentResponse(await this.request<RawContentResponse>('GET', '/gifs/search', params))
  }

  async searchCreators(opts: { order?: string; page?: number; verified?: boolean }): Promise<UserResult[]> {
    const params: Record<string, string> = { count: '80' }
    if (opts.order) params.order = opts.order
    if (opts.page) params.page = String(opts.page)
    if (opts.verified) params.verified = 'y'
    const data = await this.request<{ users?: any[]; creators?: any[] }>('GET', '/creators/search', params)
    return (data.users ?? data.creators ?? []).map(toUserResult)
  }

  async creatorPreviews(opts: { order?: string; page?: number; count?: number }): Promise<ContentResponse> {
    const params: Record<string, string> = { count: String(opts.count ?? 80) }
    if (opts.order) params.order = opts.order
    if (opts.page) params.page = String(opts.page)
    return toContentResponse(await this.request<RawContentResponse>('GET', '/creators/search/previews', params))
  }

  async getCreatorContent(username: string, opts: { type?: 'g' | 'i'; order?: string; page?: number; tags?: string }): Promise<ContentResponse> {
    const params: Record<string, string> = { count: '80' }
    if (opts.type) params.type = opts.type
    if (opts.order) params.order = opts.order
    if (opts.page) params.page = String(opts.page)
    if (opts.tags) params.search_text = opts.tags
    return toContentResponse(await this.request<RawContentResponse>('GET',
      `/users/${encodeURIComponent(username)}/search`, params))
  }

  async getCreatorTags(username: string): Promise<string[]> {
    const data = await this.request<{ tags?: string[] } | string[]>('GET',
      `/creators/${encodeURIComponent(username)}/tags`)
    if (Array.isArray(data)) return data
    return data?.tags ?? []
  }

  async getUser(username: string): Promise<UserProfile> {
    const u = await this.request<any>('GET', `https://api.redgifs.com/v1/users/${encodeURIComponent(username)}`)
    return {
      username: u?.username ?? username, name: u?.name ?? '', profileUrl: u?.url ?? u?.profileUrl ?? '',
      profilePic: u?.profileImageUrl ?? '', followers: u?.followers ?? 0, following: u?.following ?? 0,
      totalGifs: u?.totalGifs ?? u?.gifs ?? 0, views: u?.views ?? 0, likes: u?.likes ?? 0,
      blockedTags: [], preferences: []
    }
  }

  // ---- authenticated user ----

  async getMyContent(opts: { type?: 'g' | 'i' | 'all'; order?: string; page?: number }): Promise<ContentResponse> {
    const params: Record<string, string> = { count: '80' }
    if (opts.type) params.type = opts.type
    if (opts.order) params.order = opts.order
    if (opts.page) params.page = String(opts.page)
    return toContentResponse(await this.request<RawContentResponse>('GET', '/me/content', params))
  }

  async getFollowing(page: number): Promise<{ items: UserResult[]; page: number; pages: number }> {
    // /v2/me/following returns the creator list under `items` (not users/creators).
    const data = await this.request<{ items?: any[]; users?: any[]; creators?: any[]; page?: number; pages?: number }>(
      'GET', '/me/following', { page: String(page), count: '80' })
    const users = (data.items ?? data.users ?? data.creators ?? []).map(toUserResult)
    return { items: users, page: data.page ?? page, pages: data.pages ?? page }
  }

  async getFollowers(page: number): Promise<{ items: UserResult[]; page: number; pages: number }> {
    const data = await this.request<{ items?: any[]; users?: any[]; creators?: any[]; page?: number; pages?: number }>(
      'GET', '/me/followers', { page: String(page), count: '80' })
    const users = (data.items ?? data.users ?? data.creators ?? []).map(toUserResult)
    return { items: users, page: data.page ?? page, pages: data.pages ?? page }
  }

  // ---- niches ----

  async getNichesTrending(): Promise<Niche[]> {
    return this.niches('GET', '/niches/trending/search')
  }
  async getNicheCategories(): Promise<string[]> {
    // Unlike the other niche endpoints, /niches/categories returns bare
    // category-name strings under `categories`, not niche objects.
    const data = await this.request<{ categories?: string[] }>('GET', '/niches/categories')
    return data.categories ?? []
  }
  async getMyNiches(): Promise<Niche[]> {
    return this.niches('GET', '/niches/my')
  }
  async getFollowingNiches(): Promise<Niche[]> {
    return this.niches('GET', '/niches/following')
  }
  async getRelatedNiches(id: string): Promise<Niche[]> {
    return this.niches('GET', `/niches/${encodeURIComponent(id)}/related`)
  }
  async getNichePreviews(opts: { order?: string; page?: number; count?: number }): Promise<Niche[]> {
    const params: Record<string, string> = { count: String(opts.count ?? 80) }
    if (opts.order) params.order = opts.order
    if (opts.page) params.page = String(opts.page)
    return this.niches('GET', '/niches/search/previews', params)
  }

  private async niches(method: string, path: string, params?: Record<string, string>): Promise<Niche[]> {
    const data = await this.request<{ niches?: any[]; categories?: any[] } | any[]>(method, path, params)
    const list = Array.isArray(data) ? data : (data?.niches ?? data?.categories ?? [])
    return list.map(toNiche)
  }

  async nicheFeedback(nicheId: string, gifId: string, state: 'up' | 'down'): Promise<void> {
    await this.request<void>('POST', `/niches/${encodeURIComponent(nicheId)}/feedback`,
      undefined, true, { gif: gifId, state })
  }

  // ---- preferences ----

  async updatePreferences(ops: Array<{ op: string; path: string; value: unknown }>): Promise<void> {
    await this.request<void>('PATCH', 'https://api.redgifs.com/v1/me', undefined, true, { operations: ops })
  }

  // ---- follows ----

  // Follow/unfollow live on the v1 API, keyed by username (not the v2 BASE).
  async followUser(username: string): Promise<void> {
    await this.request<void>('PUT', `https://api.redgifs.com/v1/me/follows/${encodeURIComponent(username)}`,
      undefined, true, { source: 'profile', source_id: null, position: 0 })
  }

  async unfollowUser(username: string): Promise<void> {
    await this.request<void>('DELETE', `https://api.redgifs.com/v1/me/follows/${encodeURIComponent(username)}`,
      undefined, true, { source: 'profile', source_id: null, position: 0 })
  }

  // The follow-list response shape is unverified, so accept the plausible
  // envelopes (bare array / users / follows / creators) and elements that are
  // either bare username strings or objects with username/name.
  async getFollows(): Promise<string[]> {
    const data = await this.request<any>('GET', 'https://api.redgifs.com/v1/me/follows')
    const list: any[] = Array.isArray(data)
      ? data
      : (data?.users ?? data?.follows ?? data?.creators ?? [])
    return list
      .map((e) => (typeof e === 'string' ? e : (e?.username ?? e?.name ?? '')))
      .filter((u): u is string => !!u)
  }

  // ---- collections (mutations) ----

  async addToCollection(folderId: string, gifId: string): Promise<void> {
    await this.request<void>('POST', `/me/collections/${encodeURIComponent(folderId)}/gifs`,
      undefined, true, { gifId, context: null })
  }

  async createCollection(name: string): Promise<void> {
    await this.request<void>('POST', '/me/collections', undefined, true, { folderName: name })
  }
}

function toUserResult(u: any): UserResult {
  return {
    username: u?.username ?? '', name: u?.name ?? '', profileImageUrl: u?.profileImageUrl ?? '',
    profileUrl: u?.profileUrl ?? '', followers: u?.followers ?? 0, gifs: u?.gifs ?? 0,
    views: u?.views ?? 0, verified: !!u?.verified
  }
}

function toNiche(n: any): Niche {
  return {
    id: n?.id ?? '', name: n?.name ?? '', description: n?.description ?? '',
    gifs: n?.gifs ?? 0, subscribers: n?.subscribers ?? 0,
    thumbnail: n?.thumbnail ?? '', cover: n?.cover, owner: n?.owner
  }
}
