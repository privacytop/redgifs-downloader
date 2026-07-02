import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { EVT, IPC } from '../shared/ipc'
import type { DownloadTask } from '../shared/types'
import { RedgifsApi } from './api'
import { Downloader } from './downloader'
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

  ipcMain.handle(IPC.searchUsers, (_e, q: string) => api.searchUsers(q))
  ipcMain.handle(IPC.getUserContent, (_e, u: string, o: string, p: number) => api.getUserContent(u, o, p))
  ipcMain.handle(IPC.getProfile, () => api.getProfile())
  ipcMain.handle(IPC.getLikes, (_e, p: number) => api.getLikes(p))
  ipcMain.handle(IPC.getCollections, (_e, u?: string) => api.getCollections(u))
  ipcMain.handle(IPC.getCollectionContent, (_e, id: string, p: number) => api.getCollectionContent(id, p))

  ipcMain.handle(IPC.downloadStart, (_e, req) => downloader.start(req))
  ipcMain.handle(IPC.downloadList, () => downloader.list())
  ipcMain.handle(IPC.downloadPause, (_e, id: string) => downloader.pause(id))
  ipcMain.handle(IPC.downloadResume, (_e, id: string) => downloader.resume(id))
  ipcMain.handle(IPC.downloadCancel, (_e, id: string) => downloader.cancel(id))

  ipcMain.handle(IPC.settingsGet, () => storage.getSettings())
  ipcMain.handle(IPC.settingsUpdate, (_e, s) => storage.updateSettings(s))
  ipcMain.handle(IPC.statsGet, () => storage.getStats())
  ipcMain.handle(IPC.historyGet, (_e, u?: string, l?: number) => storage.getHistory(u, l))

  // Phase 2 stubs so the renderer contract is complete now.
  ipcMain.handle(IPC.authStatus, () => ({ authenticated: api.isAuthenticated() }))
  ipcMain.handle(IPC.authLogin, () => ({ authenticated: api.isAuthenticated() }))
  ipcMain.handle(IPC.authLogout, () => { api.clearUserToken(); storage.clearUserToken() })

  ipcMain.handle(IPC.openPath, (_e, p: string) => shell.openPath(p).then(() => undefined))
  ipcMain.handle(IPC.pickFolder, async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
}
