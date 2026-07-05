import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { EVT, IPC } from '../shared/ipc'
import type { Content, DownloadTask } from '../shared/types'
import { RedgifsApi } from './api'
import { AuthManager } from './auth'
import { Downloader } from './downloader'
import { indexLibrary } from './indexer'
import type { Storage } from './storage'

export function registerIpc(win: BrowserWindow, storage: Storage): void {
  const api = new RedgifsApi()
  const token = storage.getUserToken()
  if (token) api.setUserToken(token)

  const send = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
  const downloader = new Downloader({
    api, storage,
    onUpdate: (t: DownloadTask) => send(EVT.downloadUpdated, t),
    onProgress: (t: DownloadTask) => send(EVT.downloadProgress, t)
  })
  const auth = new AuthManager({
    api,
    storage,
    onChange: (status) => send(EVT.authChanged, status)
  })
  // Enable silent token refresh (proactive timer + reactive on 401) and kick
  // one off now if the stored token is already near expiry.
  auth.init()

  ipcMain.handle(IPC.searchUsers, (_e, q: string) => api.searchUsers(q))
  ipcMain.handle(IPC.searchSuggest, (_e, q: string) => api.searchSuggest(q))
  ipcMain.handle(IPC.searchNiches, (_e, q: string) => api.searchNiches(q))
  ipcMain.handle(IPC.recommendSimilar, (_e, gifId: string, page: number) =>
    api.recommendSimilar(gifId, page))
  ipcMain.handle(IPC.getUserContent, (_e, u: string, o: string, p: number) => api.getUserContent(u, o, p))
  ipcMain.handle(IPC.getProfile, () => api.getProfile())
  ipcMain.handle(IPC.getLikes, async (_e, p: number) => {
    const r = await api.getLikes(p)
    storage.cacheContents(r.contents, { type: 'liked', id: 'liked' })
    return r
  })
  ipcMain.handle(IPC.getLikedIds, () => api.getLikedIds())
  ipcMain.handle(IPC.getCollections, (_e, u?: string) => api.getCollections(u))
  ipcMain.handle(IPC.getCollectionContent, async (_e, id: string, p: number) => {
    const r = await api.getCollectionContent(id, p)
    storage.cacheContents(r.contents, { type: 'collection', id })
    return r
  })
  ipcMain.handle(IPC.searchCache, (_e, filter) => storage.searchCachedGifs(filter))
  ipcMain.handle(IPC.gifCollections, (_e, gifId: string) => storage.gifCollectionIds(gifId))

  let indexing = false
  ipcMain.handle(IPC.indexLibrary, async () => {
    if (indexing) throw new Error('Library indexing already in progress')
    indexing = true
    try {
      return await indexLibrary(api, storage, (p) => send(EVT.libraryProgress, p))
    } finally {
      indexing = false
    }
  })

  ipcMain.handle(IPC.getForYou, (_e, p: number) => api.getForYou(p))
  ipcMain.handle(IPC.searchGifs, (_e, opts) => api.searchGifs(opts))
  ipcMain.handle(IPC.likeGif, (_e, id: string) => api.likeGif(id))
  ipcMain.handle(IPC.unlikeGif, (_e, id: string) => api.unlikeGif(id))
  ipcMain.handle(IPC.searchCreators, (_e, opts) => api.searchCreators(opts))
  ipcMain.handle(IPC.creatorPreviews, (_e, opts) => api.creatorPreviews(opts))
  ipcMain.handle(IPC.getCreatorContent, (_e, u: string, opts) => api.getCreatorContent(u, opts))
  ipcMain.handle(IPC.getCreatorTags, (_e, u: string) => api.getCreatorTags(u))
  ipcMain.handle(IPC.getUser, (_e, u: string) => api.getUser(u))
  ipcMain.handle(IPC.getMyContent, (_e, opts) => api.getMyContent(opts))
  ipcMain.handle(IPC.getFollowing, (_e, p: number) => api.getFollowing(p))
  ipcMain.handle(IPC.getTrendingCreators, (_e, p: number) => api.getTrendingCreators(p))
  ipcMain.handle(IPC.getFollowers, (_e, p: number) => api.getFollowers(p))

  ipcMain.handle(IPC.getNichesTrending, () => api.getNichesTrending())
  ipcMain.handle(IPC.getNicheCategories, () => api.getNicheCategories())
  ipcMain.handle(IPC.getMyNiches, () => api.getMyNiches())
  ipcMain.handle(IPC.getFollowingNiches, () => api.getFollowingNiches())
  ipcMain.handle(IPC.getRelatedNiches, (_e, id: string) => api.getRelatedNiches(id))
  ipcMain.handle(IPC.getNichePreviews, (_e, opts) => api.getNichePreviews(opts))
  ipcMain.handle(IPC.nicheFeedback, (_e, nicheId: string, gifId: string, state: 'up' | 'down') =>
    api.nicheFeedback(nicheId, gifId, state))

  ipcMain.handle(IPC.followUser, (_e, u: string) => api.followUser(u))
  ipcMain.handle(IPC.unfollowUser, (_e, u: string) => api.unfollowUser(u))
  ipcMain.handle(IPC.getFollows, () => api.getFollows())
  ipcMain.handle(IPC.addToCollection, async (_e, folderId: string, gifId: string) => {
    await api.addToCollection(folderId, gifId)
    // Persist the membership so reopening the menu still shows the ✓ and lets
    // the user toggle it back off.
    storage.addGifMembership(gifId, 'collection', folderId)
  })
  ipcMain.handle(IPC.removeFromCollection, async (_e, folderId: string, gifId: string) => {
    await api.removeFromCollection(folderId, gifId)
    // Keep the local membership cache in sync so ✓ markers update immediately.
    storage.removeGifMembership(gifId, 'collection', folderId)
  })
  ipcMain.handle(IPC.createCollection, (_e, name: string) => api.createCollection(name))

  ipcMain.handle(IPC.updatePreferences, (_e, ops) => api.updatePreferences(ops))
  ipcMain.handle(IPC.getAllTags, () => api.getAllTags())

  ipcMain.handle(IPC.downloadStart, (_e, req) => downloader.start(req))
  ipcMain.handle(IPC.downloadContents, (_e, contents: Content[], username?: string) =>
    downloader.startContents(contents, username))
  ipcMain.handle(IPC.downloadList, () => downloader.list())
  ipcMain.handle(IPC.downloadPause, (_e, id: string) => downloader.pause(id))
  ipcMain.handle(IPC.downloadResume, (_e, id: string) => downloader.resume(id))
  ipcMain.handle(IPC.downloadCancel, (_e, id: string) => downloader.cancel(id))

  ipcMain.handle(IPC.settingsGet, () => storage.getSettings())
  ipcMain.handle(IPC.settingsUpdate, (_e, s) => storage.updateSettings(s))
  ipcMain.handle(IPC.statsGet, () => storage.getStats())
  ipcMain.handle(IPC.historyGet, (_e, u?: string, l?: number) => storage.getHistory(u, l))

  ipcMain.handle(IPC.authStatus, () => auth.status())
  ipcMain.handle(IPC.authLogin, () => auth.login())
  ipcMain.handle(IPC.authLogout, () => auth.logout())

  ipcMain.handle(IPC.openPath, (_e, p: string) => shell.openPath(p).then(() => undefined))
  ipcMain.handle(IPC.pickFolder, async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
}
