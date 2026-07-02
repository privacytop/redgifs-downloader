# Electron Rewrite — Phase 2 (Auth Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Real in-app RedGifs login that captures a user bearer token from the live redgifs.com session (Kinde-compatible), unlocking `/me`, likes and private collections. Fix collection/single download resume. Backend only — full UI comes in the frontend-design phase, plus one minimal temporary Login button for verification.

**Architecture:** An Electron `BrowserWindow` on a persistent partition loads real `https://www.redgifs.com`; the main process sniffs the `Authorization: Bearer` header off outgoing `api.redgifs.com` requests (with a localStorage JWT scan fallback), validates it's a real user token, stores it, and sets it on the API client. Design spec §4: `docs/superpowers/specs/2026-07-02-electron-rewrite-design.md`.

**Tech Stack:** Electron 31, TypeScript, vitest. Working dir: `desktop/`. Branch: `electron-rewrite`.

**Context — already built (Phase 1, do not rebuild):** `RedgifsApi` (`api.ts`) with `setUserToken/clearUserToken/isAuthenticated` + likes/collections methods; `SqliteStorage` (`storage.ts`) with `getUserToken/setUserToken/clearUserToken`; `Downloader` (`downloader.ts`) handling user/likes/collection/single; `registerIpc` (`ipc.ts`) with STUB auth handlers; shared `IPC`/`EVT`/`AuthStatus` in `shared/`. Renderer nav is Browse/Downloads/Settings.

---

## Task 1: JWT user-token detection util

**Files:** Create `desktop/src/main/jwt.ts`; Test `desktop/src/main/jwt.test.ts`.

- [ ] **Step 1: Write the failing test** (`jwt.test.ts`):

```ts
import { describe, it, expect } from 'vitest'
import { decodeJwt, isUserToken } from './jwt'

function jwt(payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`
}

describe('jwt', () => {
  it('decodes a base64url payload', () => {
    expect(decodeJwt(jwt({ sub: 'user/42' }))?.sub).toBe('user/42')
  })
  it('rejects malformed tokens', () => {
    expect(decodeJwt('nope')).toBeNull()
    expect(decodeJwt('a.b')).toBeNull()
  })
  it('accepts a real user token', () => {
    expect(isUserToken(jwt({ sub: 'user/42' }))).toBe(true)
  })
  it('rejects an anonymous client token', () => {
    expect(isUserToken(jwt({ sub: 'client/abc' }))).toBe(false)
  })
  it('rejects garbage', () => {
    expect(isUserToken('')).toBe(false)
    expect(isUserToken('not-a-jwt')).toBe(false)
  })
})
```

- [ ] **Step 2: Run — verify fail.** `cd desktop && npm test -- jwt` → FAIL (module missing).

- [ ] **Step 3: Implement `jwt.ts`:**

```ts
// Decode + classify RedGifs JWTs. Anonymous temp tokens have sub "client/...";
// real user tokens do not. No signature verification (we only classify).
export function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

export function isUserToken(token: string): boolean {
  if (!token || token.length < 20) return false
  const payload = decodeJwt(token)
  if (!payload) return false
  const sub = payload.sub
  if (typeof sub === 'string' && sub.startsWith('client/')) return false
  return true
}
```

- [ ] **Step 4: Run — verify pass.** `npm test -- jwt` → 5 passing. `npm run typecheck` clean.

- [ ] **Step 5: Commit.** `git add desktop/src/main/jwt.ts desktop/src/main/jwt.test.ts && git commit -m "feat(desktop): JWT user-token detection"`

---

## Task 2: AuthManager (login capture)

**Files:** Create `desktop/src/main/auth.ts`.

- [ ] **Step 1: Implement `auth.ts`:**

```ts
import { BrowserWindow, session } from 'electron'
import type { AuthStatus } from '../shared/types'
import type { RedgifsApi } from './api'
import type { Storage } from './storage'
import { isUserToken } from './jwt'

const PARTITION = 'persist:redgifs'
// Load the site root (login is a modal there); token capture happens on the
// first authed api.redgifs.com request after the user logs in, regardless of route.
const LOGIN_URL = 'https://www.redgifs.com/'

export interface AuthDeps {
  api: RedgifsApi
  storage: Storage
  onChange: (status: AuthStatus) => void
}

export class AuthManager {
  private win: BrowserWindow | null = null

  constructor(private deps: AuthDeps) {}

  status(): AuthStatus {
    return { authenticated: this.deps.api.isAuthenticated() }
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

      const finish = (token?: string): void => {
        if (settled) return
        settled = true
        // Detach the header listener.
        ses.webRequest.onBeforeSendHeaders(null)
        if (token) {
          this.deps.api.setUserToken(token)
          this.deps.storage.setUserToken(token)
        }
        const status: AuthStatus = { authenticated: !!token }
        this.deps.onChange(status)
        const w = this.win
        this.win = null
        if (w && !w.isDestroyed()) w.close()
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
```

- [ ] **Step 2: Typecheck.** `cd desktop && npm run typecheck` → clean. (No unit test: needs a live Electron BrowserWindow + real login; verified manually in Task 5.)

- [ ] **Step 3: Commit.** `git add desktop/src/main/auth.ts && git commit -m "feat(desktop): AuthManager in-app login token capture"`

---

## Task 3: Wire AuthManager into IPC

**Files:** Modify `desktop/src/main/ipc.ts`.

- [ ] **Step 1:** Add the import at the top of `ipc.ts` (after the existing imports):

```ts
import { AuthManager } from './auth'
```

- [ ] **Step 2:** Inside `registerIpc`, after the `downloader` is constructed, add:

```ts
  const auth = new AuthManager({
    api,
    storage,
    onChange: (status) => send(EVT.authChanged, status)
  })
```

- [ ] **Step 3:** Replace the three Phase-2 stub handlers:

```ts
  // Phase 2 stubs so the renderer contract is complete now.
  ipcMain.handle(IPC.authStatus, () => ({ authenticated: api.isAuthenticated() }))
  ipcMain.handle(IPC.authLogin, () => ({ authenticated: api.isAuthenticated() }))
  ipcMain.handle(IPC.authLogout, () => { api.clearUserToken(); storage.clearUserToken() })
```

with:

```ts
  ipcMain.handle(IPC.authStatus, () => auth.status())
  ipcMain.handle(IPC.authLogin, () => auth.login())
  ipcMain.handle(IPC.authLogout, () => auth.logout())
```

- [ ] **Step 4: Typecheck.** `cd desktop && npm run typecheck` → clean.

- [ ] **Step 5: Commit.** `git add desktop/src/main/ipc.ts && git commit -m "feat(desktop): wire real AuthManager into IPC"`

---

## Task 4: Fix collection/single download resume

**Files:** Modify `desktop/src/main/downloader.ts`.

- [ ] **Step 1:** Add a per-task request map. In the `Downloader` class field declarations (near `private tasks = ...`), add:

```ts
  private requests = new Map<string, DownloadRequest>()
```

- [ ] **Step 2:** In `start(request)`, persist the request. After `this.tasks.set(task.id, task)` add:

```ts
    this.requests.set(task.id, request)
```

- [ ] **Step 3:** Replace the `resume(id)` method body's request reconstruction. Change:

```ts
  resume(id: string): void {
    const t = this.tasks.get(id)
    if (!t || t.status !== 'paused') return
    this.aborters.set(id, new AbortController())
    // TODO(phase2): persist the original DownloadRequest per task and reuse it here.
    // Current rebuild only carries type+username, so collection/single resume is unsupported
    // and user resume re-fetches all pages (hasDownloaded dedupe keeps results correct).
    const req = { type: t.type, username: t.username, quality: undefined } as DownloadRequest
    void this.run(t, req, this.deps.storage.getSettings())
  }
```

to:

```ts
  resume(id: string): void {
    const t = this.tasks.get(id)
    if (!t || t.status !== 'paused') return
    const req = this.requests.get(id)
    if (!req) return
    this.aborters.set(id, new AbortController())
    void this.run(t, req, this.deps.storage.getSettings())
  }
```

- [ ] **Step 4:** Verify existing tests still pass and typecheck. `cd desktop && npm test -- downloader && npm run typecheck` → 3 passing, clean.

- [ ] **Step 5: Commit.** `git add desktop/src/main/downloader.ts && git commit -m "fix(desktop): reuse original request on download resume"`

---

## Task 5: Minimal temporary Login control + auth status (renderer)

This is a THROWAWAY control for verifying login; the frontend-design phase replaces it. Keep it minimal.

**Files:** Modify `desktop/src/renderer/src/App.tsx`; Modify `desktop/src/renderer/src/styles.css`.

- [ ] **Step 1:** In `App.tsx`, add auth state + a sidebar footer control. Replace the whole component with:

```tsx
import { useEffect, useState } from 'react'
import Browse from './pages/Browse'
import Downloads from './pages/Downloads'
import SettingsPage from './pages/SettingsPage'
import Toasts, { useToasts } from './components/Toasts'
import type { AuthStatus } from '@shared/types'

type Page = 'browse' | 'downloads' | 'settings'
const NAV: { id: Page; label: string }[] = [
  { id: 'browse', label: 'Browse' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'settings', label: 'Settings' }
]

export default function App(): JSX.Element {
  const [page, setPage] = useState<Page>('browse')
  const [auth, setAuth] = useState<AuthStatus>({ authenticated: false })
  const toasts = useToasts()

  useEffect(() => {
    window.api.authStatus().then(setAuth)
    const offToast = window.api.on('evt:toast', (t) => toasts.push(t.message, t.type))
    const offAuth = window.api.on('evt:auth:changed', (s) => {
      setAuth(s)
      toasts.push(s.authenticated ? 'Logged in' : 'Logged out', s.authenticated ? 'success' : 'info')
    })
    return () => { offToast(); offAuth() }
  }, [])

  async function toggleAuth(): Promise<void> {
    if (auth.authenticated) await window.api.logout()
    else await window.api.login()
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">R</span> RedGifs<small>Downloader</small></div>
        <nav>
          {NAV.map((n) => (
            <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="auth-box">
          <span className={`auth-dot ${auth.authenticated ? 'on' : ''}`} />
          {auth.authenticated ? 'Logged in' : 'Not logged in'}
          <button className="btn btn-sm" onClick={toggleAuth}>{auth.authenticated ? 'Logout' : 'Login'}</button>
        </div>
      </aside>
      <main className="content">
        {page === 'browse' && <Browse notify={toasts.push} />}
        {page === 'downloads' && <Downloads />}
        {page === 'settings' && <SettingsPage notify={toasts.push} />}
      </main>
      <Toasts items={toasts.items} />
    </div>
  )
}
```

- [ ] **Step 2:** Append to `styles.css`:

```css
.auth-box { margin-top: auto; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
.auth-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.auth-dot.on { background: var(--ok); }
```

- [ ] **Step 3:** Typecheck + build. `cd desktop && npm run typecheck && npm run build` → clean.

- [ ] **Step 4: Commit.** `git add desktop/src/renderer && git commit -m "feat(desktop): temporary login control + auth status (throwaway, pre-redesign)"`

---

## Task 6: Verification

- [ ] **Step 1:** All tests + build. `cd desktop && npm test && npm run test:main && npm run typecheck && npm run build` → all green.
- [ ] **Step 2:** Launch `npm run dev`. Click **Login** → a redgifs.com login window opens → log in → window closes, sidebar shows "Logged in" (token captured). Then a likes/collection API call (via a later UI or the console) should succeed with the user token.
- [ ] **Step 3 (manual, user):** confirm `authStatus` persists across app restart (token stored in SQLite), and Logout clears it.

---

## Out of scope (frontend-design phase)
All real UI: proper auth/profile display, Likes page, Collections page + collection content, history view, statistics dashboard, and the full visual redesign. The temporary Login control in Task 5 is replaced there.
