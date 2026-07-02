import type {
  Collection, Content, ContentResponse, UserProfile, UserResult
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
    urls: { hd: g.urls?.hd, sd: g.urls?.sd, thumbnail: g.urls?.thumbnail, poster: g.urls?.poster },
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

  private async request<T>(method: string, path: string, params?: Record<string, string>, auth = true): Promise<T> {
    const url = new URL(BASE + path)
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    for (let attempt = 0; attempt <= 3; attempt++) {
      await this.rl.wait()
      const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'RedGifs-Downloader/4.0' }
      if (auth) headers.Authorization = `Bearer ${await this.token()}`
      const resp = await fetch(url, { method, headers })
      if (resp.status === 200) return (await resp.json()) as T
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
    return (data.users ?? []).map((u) => ({
      username: u.username, name: u.name ?? '', profileImageUrl: u.profileImageUrl ?? '',
      profileUrl: u.profileUrl ?? '', followers: u.followers ?? 0, gifs: u.gifs ?? 0,
      views: u.views ?? 0, verified: !!u.verified
    }))
  }

  async getUserContent(username: string, order: string, page: number): Promise<ContentResponse> {
    const data = await this.request<RawContentResponse>('GET', `/users/${encodeURIComponent(username)}/search`,
      { order, count: '80', page: String(page) })
    return toContentResponse(data)
  }

  async getProfile(): Promise<UserProfile> {
    const u = await this.request<any>('GET', '/me')
    return {
      username: u.username, name: u.name ?? '', profileUrl: u.profileUrl ?? '',
      profilePic: u.profileImageUrl ?? '', followers: u.followers ?? 0, following: u.following ?? 0,
      totalGifs: u.gifs ?? 0, views: u.views ?? 0, likes: u.likes ?? 0
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
}
