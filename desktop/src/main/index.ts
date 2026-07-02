import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { SqliteStorage } from './storage'
import { registerIpc } from './ipc'

let storage: SqliteStorage

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 940, minHeight: 640,
    backgroundColor: '#0f172a', show: false, autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // Let the immersive player autoplay clips (with sound) without a prior
      // gesture — otherwise the first clip stays paused until the user scrolls.
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  win.on('ready-to-show', () => win.show())

  // Allow the renderer to read RedGifs media into a <canvas> (for thumbnail
  // frame capture): inject a permissive CORS header on their responses so a
  // crossOrigin='anonymous' <video>/<img> doesn't taint the canvas.
  win.webContents.session.webRequest.onHeadersReceived(
    { urls: ['*://*.redgifs.com/*'] },
    (details, callback) => {
      const responseHeaders = { ...details.responseHeaders }
      responseHeaders['Access-Control-Allow-Origin'] = ['*']
      callback({ responseHeaders })
    }
  )

  registerIpc(win, storage)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  storage = new SqliteStorage(join(app.getPath('userData'), 'redgifs.db'),
    { downloadPath: join(app.getPath('downloads'), 'RedGifs') })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  storage?.close()
  if (process.platform !== 'darwin') app.quit()
})
