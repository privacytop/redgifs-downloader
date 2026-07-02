import { BrowserWindow, session } from 'electron'
import type { AuthStatus } from '../shared/types'
import type { RedgifsApi } from './api'
import type { Storage } from './storage'
import { isUserToken } from './jwt'

const PARTITION = 'persist:redgifs'
// The SPA serves /login as a client route that opens the login modal directly
// (it falls back to the app shell if the route is unknown, so this is safe).
// Token capture happens on the first authed api.redgifs.com request after login.
const LOGIN_URL = 'https://www.redgifs.com/login'

export interface AuthDeps {
  api: RedgifsApi
  storage: Storage
  onChange: (status: AuthStatus) => void
}

export class AuthManager {
  private win: BrowserWindow | null = null

  constructor(private deps: AuthDeps) {}

  async status(): Promise<AuthStatus> {
    if (!this.deps.api.isAuthenticated()) return { authenticated: false }
    return { authenticated: true, username: await this.fetchUsername() }
  }

  // Best-effort: resolve the logged-in username via /me. Never throws; returns
  // undefined on failure (e.g. transient network error or an expired token).
  private async fetchUsername(): Promise<string | undefined> {
    try {
      const profile = await this.deps.api.getProfile()
      return profile.username || undefined
    } catch {
      return undefined
    }
  }

  /**
   * Opens a real redgifs.com login window on a persistent partition and captures
   * the user bearer token: primarily by sniffing the Authorization header on
   * api.redgifs.com requests, with a localStorage JWT scan as a fallback.
   * Resolves { authenticated:false } if the window is closed without a token.
   */
  async login(): Promise<AuthStatus> {
    if (this.win && !this.win.isDestroyed()) this.win.focus()

    return new Promise<AuthStatus>((resolve) => {
      const ses = session.fromPartition(PARTITION)
      let settled = false

      const finish = async (token?: string): Promise<void> => {
        if (settled) return
        settled = true
        // Detach the header listener.
        ses.webRequest.onBeforeSendHeaders(null)
        // Close the window immediately so the user isn't left staring at it while
        // we resolve the profile.
        const w = this.win
        this.win = null
        if (w && !w.isDestroyed()) w.close()

        let username: string | undefined
        if (token) {
          this.deps.api.setUserToken(token)
          this.deps.storage.setUserToken(token)
          username = await this.fetchUsername()
        }
        const status: AuthStatus = { authenticated: !!token, username }
        this.deps.onChange(status)
        resolve(status)
      }

      // Primary capture: sniff Authorization: Bearer on api.redgifs.com calls.
      ses.webRequest.onBeforeSendHeaders({ urls: ['*://api.redgifs.com/*'] }, (details, cb) => {
        const h = details.requestHeaders
        const auth = h['Authorization'] || h['authorization'] || ''
        const m = /^Bearer\s+(.+)$/i.exec(auth)
        if (m && isUserToken(m[1])) finish(m[1])
        cb({ requestHeaders: h })
      })

      this.win = new BrowserWindow({
        width: 520,
        height: 760,
        title: 'Log in to RedGifs',
        autoHideMenuBar: true,
        webPreferences: { partition: PARTITION }
      })
      this.win.on('closed', () => finish(undefined))

      // Fallback: poll localStorage for a user JWT.
      const scan = (): void => {
        if (settled || !this.win || this.win.isDestroyed()) return
        this.win.webContents
          .executeJavaScript(
            `(function(){for(var i=0;i<localStorage.length;i++){var v=localStorage.getItem(localStorage.key(i));if(v&&v.indexOf('eyJ')===0&&v.length>40)return v;}return '';})()`
          )
          .then((v: string) => {
            if (v && isUserToken(v)) finish(v)
            else setTimeout(scan, 1500)
          })
          .catch(() => setTimeout(scan, 1500))
      }
      this.win.webContents.on('did-finish-load', () => setTimeout(scan, 1000))

      void this.win.loadURL(LOGIN_URL)
    })
  }

  async logout(): Promise<void> {
    this.deps.api.clearUserToken()
    this.deps.storage.clearUserToken()
    try {
      await session.fromPartition(PARTITION).clearStorageData()
    } catch {
      // best-effort
    }
    this.deps.onChange({ authenticated: false })
  }
}
