// Central IPC contract shared by main <-> preload <-> renderer.
// Channel string constants keep both sides in sync; the RedgifsApi interface
// is the typed surface exposed on `window.api`.

import type {
  AuthStatus,
  Collection,
  Content,
  ContentResponse,
  DownloadRecord,
  DownloadRequest,
  DownloadTask,
  Niche,
  Settings,
  Statistics,
  ToastPayload,
  UserProfile,
  UserResult
} from './types'

// Request/response (ipcRenderer.invoke) channels.
export const IPC = {
  authLogin: 'auth:login',
  authLogout: 'auth:logout',
  authStatus: 'auth:status',

  searchUsers: 'api:searchUsers',
  getUserContent: 'api:getUserContent',
  getProfile: 'api:getProfile',
  getCollections: 'api:getCollections',
  getCollectionContent: 'api:getCollectionContent',
  getLikes: 'api:getLikes',

  getForYou: 'api:getForYou',
  searchGifs: 'api:searchGifs',
  likeGif: 'api:likeGif',
  unlikeGif: 'api:unlikeGif',
  searchCreators: 'api:searchCreators',
  creatorPreviews: 'api:creatorPreviews',
  getCreatorContent: 'api:getCreatorContent',
  getCreatorTags: 'api:getCreatorTags',
  getUser: 'api:getUser',
  getMyContent: 'api:getMyContent',
  getFollowing: 'api:getFollowing',
  getFollowers: 'api:getFollowers',

  getNichesTrending: 'api:getNichesTrending',
  getNicheCategories: 'api:getNicheCategories',
  getMyNiches: 'api:getMyNiches',
  getFollowingNiches: 'api:getFollowingNiches',
  getRelatedNiches: 'api:getRelatedNiches',
  getNichePreviews: 'api:getNichePreviews',
  nicheFeedback: 'api:nicheFeedback',

  followUser: 'api:followUser',
  unfollowUser: 'api:unfollowUser',
  getFollows: 'api:getFollows',
  addToCollection: 'api:addToCollection',
  removeFromCollection: 'api:removeFromCollection',
  createCollection: 'api:createCollection',

  updatePreferences: 'api:updatePreferences',

  downloadStart: 'download:start',
  downloadContents: 'download:contents',
  downloadList: 'download:list',
  downloadPause: 'download:pause',
  downloadResume: 'download:resume',
  downloadCancel: 'download:cancel',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  statsGet: 'stats:get',
  historyGet: 'history:get',
  searchCache: 'cache:search',
  gifCollections: 'cache:gifCollections',

  openPath: 'shell:openPath',
  pickFolder: 'dialog:pickFolder'
} as const

// Event (main -> renderer, ipcRenderer.on) channels.
export const EVT = {
  authChanged: 'evt:auth:changed',
  downloadProgress: 'evt:download:progress',
  downloadUpdated: 'evt:download:updated',
  toast: 'evt:toast'
} as const

export type RendererEventMap = {
  [EVT.authChanged]: AuthStatus
  [EVT.downloadProgress]: DownloadTask
  [EVT.downloadUpdated]: DownloadTask
  [EVT.toast]: ToastPayload
}

// The typed API exposed to the renderer via contextBridge as `window.api`.
export interface RedgifsApi {
  login(): Promise<AuthStatus>
  logout(): Promise<void>
  authStatus(): Promise<AuthStatus>

  searchUsers(query: string): Promise<UserResult[]>
  getUserContent(username: string, order: string, page: number): Promise<ContentResponse>
  getProfile(): Promise<UserProfile>
  getCollections(username?: string): Promise<Collection[]>
  getCollectionContent(collectionId: string, page: number): Promise<ContentResponse>
  getLikes(page: number): Promise<ContentResponse>

  getForYou(page: number): Promise<ContentResponse>
  searchGifs(opts: { type?: 'g' | 'i'; order?: string; page?: number; verified?: boolean; tags?: string; search?: string }): Promise<ContentResponse>
  likeGif(id: string): Promise<void>
  unlikeGif(id: string): Promise<void>
  searchCreators(opts: { order?: string; page?: number; verified?: boolean }): Promise<UserResult[]>
  creatorPreviews(opts: { order?: string; page?: number; count?: number }): Promise<ContentResponse>
  getCreatorContent(username: string, opts: { type?: 'g' | 'i'; order?: string; page?: number; tags?: string }): Promise<ContentResponse>
  getCreatorTags(username: string): Promise<string[]>
  getUser(username: string): Promise<UserProfile>
  getMyContent(opts: { type?: 'g' | 'i' | 'all'; order?: string; page?: number }): Promise<ContentResponse>
  getFollowing(page: number): Promise<{ items: UserResult[]; page: number; pages: number }>
  getFollowers(page: number): Promise<{ items: UserResult[]; page: number; pages: number }>

  getNichesTrending(): Promise<Niche[]>
  getNicheCategories(): Promise<string[]>
  getMyNiches(): Promise<Niche[]>
  getFollowingNiches(): Promise<Niche[]>
  getRelatedNiches(id: string): Promise<Niche[]>
  getNichePreviews(opts: { order?: string; page?: number; count?: number }): Promise<Niche[]>
  nicheFeedback(nicheId: string, gifId: string, state: 'up' | 'down'): Promise<void>

  followUser(username: string): Promise<void>
  unfollowUser(username: string): Promise<void>
  getFollows(): Promise<string[]>
  addToCollection(folderId: string, gifId: string): Promise<void>
  removeFromCollection(folderId: string, gifId: string): Promise<void>
  createCollection(name: string): Promise<void>

  updatePreferences(ops: Array<{ op: string; path: string; value: unknown }>): Promise<void>

  startDownload(request: DownloadRequest): Promise<DownloadTask>
  downloadContents(contents: Content[], username?: string): Promise<DownloadTask>
  listDownloads(): Promise<DownloadTask[]>
  pauseDownload(id: string): Promise<void>
  resumeDownload(id: string): Promise<void>
  cancelDownload(id: string): Promise<void>

  getSettings(): Promise<Settings>
  updateSettings(settings: Settings): Promise<void>
  getStats(): Promise<Statistics>
  getHistory(username?: string, limit?: number): Promise<DownloadRecord[]>
  searchCache(filter: {
    tags?: string[]
    sources?: { type: 'collection' | 'liked'; id: string }[]
    likedOnly?: boolean
  }): Promise<Content[]>
  gifCollections(gifId: string): Promise<string[]>

  openPath(path: string): Promise<void>
  pickFolder(): Promise<string | null>

  // Subscribe to a main->renderer event. Returns an unsubscribe function.
  on<K extends keyof RendererEventMap>(
    channel: K,
    listener: (payload: RendererEventMap[K]) => void
  ): () => void
}
