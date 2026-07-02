import { contextBridge, ipcRenderer } from 'electron'
import { IPC, EVT, type RedgifsApi, type RendererEventMap } from '../shared/ipc'

const api: RedgifsApi = {
  login: () => ipcRenderer.invoke(IPC.authLogin),
  logout: () => ipcRenderer.invoke(IPC.authLogout),
  authStatus: () => ipcRenderer.invoke(IPC.authStatus),

  searchUsers: (query) => ipcRenderer.invoke(IPC.searchUsers, query),
  getUserContent: (username, order, page) =>
    ipcRenderer.invoke(IPC.getUserContent, username, order, page),
  getProfile: () => ipcRenderer.invoke(IPC.getProfile),
  getCollections: (username) => ipcRenderer.invoke(IPC.getCollections, username),
  getCollectionContent: (collectionId, page) =>
    ipcRenderer.invoke(IPC.getCollectionContent, collectionId, page),
  getLikes: (page) => ipcRenderer.invoke(IPC.getLikes, page),

  getForYou: (page) => ipcRenderer.invoke(IPC.getForYou, page),
  searchGifs: (opts) => ipcRenderer.invoke(IPC.searchGifs, opts),
  likeGif: (id) => ipcRenderer.invoke(IPC.likeGif, id),
  unlikeGif: (id) => ipcRenderer.invoke(IPC.unlikeGif, id),
  searchCreators: (opts) => ipcRenderer.invoke(IPC.searchCreators, opts),
  creatorPreviews: (opts) => ipcRenderer.invoke(IPC.creatorPreviews, opts),
  getCreatorContent: (username, opts) => ipcRenderer.invoke(IPC.getCreatorContent, username, opts),
  getCreatorTags: (username) => ipcRenderer.invoke(IPC.getCreatorTags, username),
  getUser: (username) => ipcRenderer.invoke(IPC.getUser, username),
  getMyContent: (opts) => ipcRenderer.invoke(IPC.getMyContent, opts),
  getFollowing: (page) => ipcRenderer.invoke(IPC.getFollowing, page),
  getFollowers: (page) => ipcRenderer.invoke(IPC.getFollowers, page),

  getNichesTrending: () => ipcRenderer.invoke(IPC.getNichesTrending),
  getNicheCategories: () => ipcRenderer.invoke(IPC.getNicheCategories),
  getMyNiches: () => ipcRenderer.invoke(IPC.getMyNiches),
  getFollowingNiches: () => ipcRenderer.invoke(IPC.getFollowingNiches),
  getRelatedNiches: (id) => ipcRenderer.invoke(IPC.getRelatedNiches, id),
  getNichePreviews: (opts) => ipcRenderer.invoke(IPC.getNichePreviews, opts),
  nicheFeedback: (nicheId, gifId, state) =>
    ipcRenderer.invoke(IPC.nicheFeedback, nicheId, gifId, state),

  updatePreferences: (ops) => ipcRenderer.invoke(IPC.updatePreferences, ops),

  startDownload: (request) => ipcRenderer.invoke(IPC.downloadStart, request),
  downloadContents: (contents, username) =>
    ipcRenderer.invoke(IPC.downloadContents, contents, username),
  listDownloads: () => ipcRenderer.invoke(IPC.downloadList),
  pauseDownload: (id) => ipcRenderer.invoke(IPC.downloadPause, id),
  resumeDownload: (id) => ipcRenderer.invoke(IPC.downloadResume, id),
  cancelDownload: (id) => ipcRenderer.invoke(IPC.downloadCancel, id),

  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  updateSettings: (settings) => ipcRenderer.invoke(IPC.settingsUpdate, settings),
  getStats: () => ipcRenderer.invoke(IPC.statsGet),
  getHistory: (username, limit) => ipcRenderer.invoke(IPC.historyGet, username, limit),

  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),

  on: <K extends keyof RendererEventMap>(
    channel: K,
    listener: (payload: RendererEventMap[K]) => void
  ) => {
    const handler = (_e: unknown, payload: RendererEventMap[K]): void => listener(payload)
    ipcRenderer.on(channel as string, handler)
    return () => ipcRenderer.removeListener(channel as string, handler)
  }
}

// Guard against the event channel constants being unused in type-only builds.
void EVT

contextBridge.exposeInMainWorld('api', api)
