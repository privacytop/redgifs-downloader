import { BrowserWindow, session } from 'electron'
import type { AuthStatus } from '../shared/types'
import type { RedgifsApi } from './api'
import type { Storage } from './storage'
import { decodeJwt, isUserToken } from './jwt'

const PARTITION = 'persist:redgifs'
// The SPA serves /login as a client route that opens the login modal directly
// (it falls back to the app shell if the route is unknown, so this is safe).
// Token capture happens on the first authed api.redgifs.com request after login.
const LOGIN_URL = 'https://www.redgifs.com/login'
// For silent refresh we just load the site; if the Kinde SSO cookie is still
// valid the SPA re-authenticates on its own and fires authed API calls.
const HOME_URL = 'https://www.redgifs.com/'

// Refresh this long before the token's `exp`, and give a silent attempt this
// long to produce a token before giving up.
const REFRESH_LEAD_MS = 2 * 60 * 1000
const SILENT_TIMEOUT_MS = 25 * 1000

export interface AuthDeps {
  api: RedgifsApi
  storage: Storage
  onChange: (status: AuthStatus) => void
}

export class AuthManager {
  private win: BrowserWindow | null = null
  private refreshTimer: NodeJS.Timeout | null = null
  private refreshing: Promise<boolean> | null = null

  constructor(private deps: AuthDeps) {}

  /**
   * Wire up expiry handling and kick off a refresh if the stored token is
   * already (near) expired. Call once after the AuthManager is constructed.
   */
  init(): void {
    // Reactive: a 401 on an authed call triggers a silent refresh + retry.
    this.deps.api.setOnAuthExpired(() => this.silentRefresh())

    const token = this.deps.storage.getUserToken()
    if (!token) return
    const exp = decodeJwt(token)?.exp
    const nearExpiry = typeof exp === 'number' && Date.now() >= exp * 1000 - 60 * 1000
    if (nearExpiry) void this.silentRefresh()
    else this.scheduleRefresh()
  }

  status(): AuthStatus {
    if (!this.deps.api.isAuthenticated()) return { authenticated: false }
    return { authenticated: true, username: this.usernameFromToken(this.deps.storage.getUserToken()) }
  }

  // The captured token is a Kinde ID token whose `preferred_username` claim is the
  // RedGifs username (there is no /me endpoint — it 404s). Decode it locally.
  private usernameFromToken(token?: string): string | undefined {
    if (!token) return undefined
    const u = decodeJwt(token)?.preferred_username
    return typeof u === 'string' && u ? u : undefined
  }

  /**
   * Opens a real redgifs.com login window on a persistent partition and captures
   * the user bearer token by sniffing the Authorization header on api.redgifs.com
   * requests (with a localStorage JWT scan as a fallback). Resolves
   * { authenticated:false } if the window is closed without a token.
   */
  async login(): Promise<AuthStatus> {
    if (this.win && !this.win.isDestroyed()) {
      this.win.focus()
      return this.status()
    }
    const token = await this.captureToken({ show: true, url: LOGIN_URL })
    if (token) return this.applyToken(token)
    const status: AuthStatus = { authenticated: false }
    this.deps.onChange(status)
    return status
  }

  /**
   * Refresh the token with no user interaction: load redgifs.com in a hidden
   * window on the same persistent partition. If the Kinde SSO session cookie is
   * still valid the SPA silently mints a fresh token and calls the API, which we
   * sniff. Deduped (one attempt at a time); no-op with no prior session or while
   * an interactive login window is open. Resolves true on a fresh token.
   */
  async silentRefresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing
    if (!this.deps.storage.getUserToken()) return false // never signed in → no SSO session
    if (this.win && !this.win.isDestroyed()) return false // don't clash with visible login

    this.refreshing = (async () => {
      const token = await this.captureToken({
        show: false,
        url: HOME_URL,
        timeoutMs: SILENT_TIMEOUT_MS
      })
      if (token) {
        this.applyToken(token)
        return true
      }
      return false
    })()
    try {
      return await this.refreshing
    } finally {
      this.refreshing = null
    }
  }

  async logout(): Promise<void> {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    this.deps.api.clearUserToken()
    this.deps.storage.clearUserToken()
    try {
      await session.fromPartition(PARTITION).clearStorageData()
    } catch {
      // best-effort
    }
    this.deps.onChange({ authenticated: false })
  }

  // ---- internals ----

  /** Persist a freshly captured token and (re)arm the proactive refresh timer. */
  private applyToken(token: string): AuthStatus {
    this.deps.api.setUserToken(token)
    this.deps.storage.setUserToken(token)
    const status: AuthStatus = { authenticated: true, username: this.usernameFromToken(token) }
    this.deps.onChange(status)
    this.scheduleRefresh()
    return status
  }

  /** Arm a one-shot timer to silently refresh shortly before the token expires. */
  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    const token = this.deps.storage.getUserToken()
    if (!token) return
    const exp = decodeJwt(token)?.exp
    if (typeof exp !== 'number') return
    const ms = Math.max(5000, exp * 1000 - Date.now() - REFRESH_LEAD_MS)
    this.refreshTimer = setTimeout(() => void this.silentRefresh(), ms)
  }

  /**
   * Open a redgifs window on the persistent partition and resolve the first
   * user bearer token seen on an api.redgifs.com request. Visible windows wait
   * until closed; hidden windows give up after `timeoutMs`.
   */
  private captureToken(opts: {
    show: boolean
    url: string
    timeoutMs?: number
  }): Promise<string | undefined> {
    return new Promise((resolve) => {
      const ses = session.fromPartition(PARTITION)
      let settled = false
      let timer: NodeJS.Timeout | null = null
      let win: BrowserWindow | null = null

      const finish = (token?: string): void => {
        if (settled) return
        settled = true
        ses.webRequest.onBeforeSendHeaders(null)
        if (timer) clearTimeout(timer)
        const w = win
        win = null
        if (opts.show) this.win = null
        if (w && !w.isDestroyed()) w.close()
        resolve(token)
      }

      // Primary capture: sniff Authorization: Bearer on api.redgifs.com calls.
      ses.webRequest.onBeforeSendHeaders({ urls: ['*://api.redgifs.com/*'] }, (details, cb) => {
        const h = details.requestHeaders
        const auth = h['Authorization'] || h['authorization'] || ''
        const m = /^Bearer\s+(.+)$/i.exec(auth)
        if (m && isUserToken(m[1])) finish(m[1])
        cb({ requestHeaders: h })
      })

      win = new BrowserWindow({
        width: 520,
        height: 760,
        show: opts.show,
        title: 'Log in to RedGifs',
        autoHideMenuBar: true,
        webPreferences: { partition: PARTITION }
      })
      if (opts.show) {
        this.win = win
        win.on('closed', () => finish(undefined))
      }
      if (opts.timeoutMs) timer = setTimeout(() => finish(undefined), opts.timeoutMs)

      // Fallback: scan localStorage for a user JWT after the page loads.
      const target = win
      const scan = (): void => {
        if (settled || !target || target.isDestroyed()) return
        target.webContents
          .executeJavaScript(
            `(function(){for(var i=0;i<localStorage.length;i++){var v=localStorage.getItem(localStorage.key(i));if(v&&v.indexOf('eyJ')===0&&v.length>40)return v;}return '';})()`
          )
          .then((v: string) => {
            if (v && isUserToken(v)) finish(v)
            else if (!settled) setTimeout(scan, 1500)
          })
          .catch(() => {
            if (!settled) setTimeout(scan, 1500)
          })
      }
      win.webContents.on('did-finish-load', () => setTimeout(scan, 1000))

      void win.loadURL(opts.url)
    })
  }
}
