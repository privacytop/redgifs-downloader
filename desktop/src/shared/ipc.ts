// Central IPC contract shared by main <-> preload <-> renderer.
// Channel string constants keep both sides in sync; the RedgifsApi interface
// is the typed surface exposed on `window.api`.

import type {
  AuthStatus,
  Collection,
  ContentResponse,
  DownloadRecord,
  DownloadRequest,
  DownloadTask,
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

  downloadStart: 'download:start',
  downloadList: 'download:list',
  downloadPause: 'download:pause',
  downloadResume: 'download:resume',
  downloadCancel: 'download:cancel',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  statsGet: 'stats:get',
  historyGet: 'history:get',

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

  startDownload(request: DownloadRequest): Promise<DownloadTask>
  listDownloads(): Promise<DownloadTask[]>
  pauseDownload(id: string): Promise<void>
  resumeDownload(id: string): Promise<void>
  cancelDownload(id: string): Promise<void>

  getSettings(): Promise<Settings>
  updateSettings(settings: Settings): Promise<void>
  getStats(): Promise<Statistics>
  getHistory(username?: string, limit?: number): Promise<DownloadRecord[]>

  openPath(path: string): Promise<void>
  pickFolder(): Promise<string | null>

  // Subscribe to a main->renderer event. Returns an unsubscribe function.
  on<K extends keyof RendererEventMap>(
    channel: K,
    listener: (payload: RendererEventMap[K]) => void
  ): () => void
}
