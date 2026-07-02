# Electron Rewrite — Phase 1 (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable Electron + React desktop app that browses/searches public RedGifs content (anonymous token) and downloads a user's gifs concurrently to disk, with a live download queue, persisted settings, and SQLite history.

**Architecture:** Electron three-layer split — `main` (Node/TS business logic), `preload` (contextBridge → typed `window.api`), `renderer` (React/Vite UI). All logic in the main process; UI talks only through IPC. Storage via `better-sqlite3` behind a `Storage` interface. Design spec: `docs/superpowers/specs/2026-07-02-electron-rewrite-design.md`.

**Tech Stack:** Electron 31, electron-vite 2, React 18, TypeScript 5, Vite 5, better-sqlite3, @electron/rebuild, vitest.

**Working directory:** all paths below are under `desktop/` unless noted. Some scaffold files already exist (`package.json`, `electron.vite.config.ts`, `tsconfig*.json`, `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/main/ratelimit.ts`, `src/main/store.ts`). Tasks below update these where noted.

**Testing note — native module ABI:** `better-sqlite3` is a native module. `@electron/rebuild` (run via `postinstall`) compiles it for Electron's ABI so the app can load it. Plain-Node `vitest` cannot load an Electron-ABI build, so:
- `npm test` (vitest, Node ABI) covers only pure logic: `ratelimit`, API conversion, downloader helpers.
- Storage tests run through Electron's Node via `npm run test:main` (`ELECTRON_RUN_AS_NODE=1 electron …`), which uses the same ABI the app uses.

---

## Task 0: Dependencies & build wiring

**Files:**
- Modify: `desktop/package.json`
- Create: `desktop/vitest.config.ts`
- Create: `desktop/.npmrc`

- [ ] **Step 1: Update `package.json`** — add native storage, rebuild, and test deps, plus scripts.

```json
{
  "name": "redgifs-downloader",
  "version": "4.0.0",
  "description": "RedGifs Downloader — Electron + React desktop app",
  "author": "privacytop",
  "license": "MIT",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "postinstall": "electron-rebuild -f -w better-sqlite3",
    "test": "vitest run",
    "test:main": "ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs run --config vitest.config.ts src/main/storage.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json"
  },
  "dependencies": {
    "better-sqlite3": "^11.1.2"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.6.0",
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "electron": "^31.3.0",
    "electron-vite": "^2.3.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.5.3",
    "vite": "^5.3.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `.npmrc`** so native builds target Electron consistently.

```
runtime = electron
```

- [ ] **Step 3: Create `vitest.config.ts`.**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  },
  resolve: {
    alias: { '@shared': new URL('./src/shared', import.meta.url).pathname }
  }
})
```

- [ ] **Step 4: Install.**

Run: `cd desktop && npm install`
Expected: installs; `postinstall` rebuilds `better-sqlite3` for Electron (prints "Rebuild Complete").

- [ ] **Step 5: Commit.**

```bash
git add desktop/package.json desktop/.npmrc desktop/vitest.config.ts desktop/package-lock.json
git commit -m "chore(desktop): dependencies and build wiring for Electron rewrite"
```

---

## Task 1: RateLimiter test (logic already scaffolded)

**Files:**
- Test: `desktop/src/main/ratelimit.test.ts`
- Verify: `desktop/src/main/ratelimit.ts` (already exists)

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest'
import { RateLimiter } from './ratelimit'

describe('RateLimiter', () => {
  it('spaces requests by the minimum interval', async () => {
    const rl = new RateLimiter(50)
    const t0 = Date.now()
    await rl.wait() // first is immediate
    await rl.wait() // second waits ~50ms
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45)
  })

  it('honours a 429 backoff', async () => {
    const rl = new RateLimiter(1)
    rl.note429(60)
    const t0 = Date.now()
    await rl.wait()
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50)
  })
})
```

- [ ] **Step 2: Run — verify it passes** (implementation already exists).

Run: `cd desktop && npm test -- ratelimit`
Expected: 2 passing. If `ratelimit.ts` is missing, create it per the design (`wait()`, `note429(ms)`, `minIntervalMs` ctor arg).

- [ ] **Step 3: Commit.**

```bash
git add desktop/src/main/ratelimit.ts desktop/src/main/ratelimit.test.ts
git commit -m "test(desktop): rate limiter spacing and 429 backoff"
```

---

## Task 2: Storage interface + SqliteStorage

Replaces the scaffolded JSON `src/main/store.ts` with a SQLite implementation behind an interface.

**Files:**
- Create: `desktop/src/main/storage.ts`
- Delete: `desktop/src/main/store.ts`
- Test: `desktop/src/main/storage.test.ts`

- [ ] **Step 1: Write `storage.ts`.**

```ts
import Database from 'better-sqlite3'
import {
  DEFAULT_SETTINGS,
  type DownloadRecord,
  type Settings,
  type Statistics
} from '../shared/types'

export interface Storage {
  getSettings(): Settings
  updateSettings(s: Settings): void
  getUserToken(): string | undefined
  setUserToken(t: string): void
  clearUserToken(): void
  hasDownloaded(username: string, contentId: string): boolean
  addRecord(r: Omit<DownloadRecord, 'id'>): DownloadRecord
  getHistory(username?: string, limit?: number): DownloadRecord[]
  getStats(): Statistics
  close(): void
}

const SETTINGS_COLS = [
  'downloadPath', 'maxConcurrentDownloads', 'preferredQuality', 'searchOrders',
  'createUserFolders', 'overwriteExisting', 'darkMode', 'showNotifications'
] as const

export class SqliteStorage implements Storage {
  private db: Database.Database

  constructor(dbPath: string, defaults?: Partial<Settings>) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
    this.ensureSettings({ ...DEFAULT_SETTINGS, ...defaults })
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        downloadPath TEXT, maxConcurrentDownloads INTEGER, preferredQuality TEXT,
        searchOrders TEXT, createUserFolders INTEGER, overwriteExisting INTEGER,
        darkMode INTEGER, showNotifications INTEGER
      );
      CREATE TABLE IF NOT EXISTS tokens (id INTEGER PRIMARY KEY CHECK (id = 1), token TEXT);
      CREATE TABLE IF NOT EXISTS downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL, content_id TEXT NOT NULL, content_name TEXT,
        file_path TEXT, file_size INTEGER, duration REAL, width INTEGER, height INTEGER,
        has_audio INTEGER, downloaded_at INTEGER, thumbnail TEXT, search_order TEXT, rank INTEGER,
        UNIQUE(username, content_id)
      );
    `)
  }

  private ensureSettings(defaults: Settings): void {
    const row = this.db.prepare('SELECT id FROM settings WHERE id = 1').get()
    if (!row) this.writeSettings(defaults)
  }

  private writeSettings(s: Settings): void {
    this.db.prepare(`
      INSERT INTO settings (id, downloadPath, maxConcurrentDownloads, preferredQuality,
        searchOrders, createUserFolders, overwriteExisting, darkMode, showNotifications)
      VALUES (1, @downloadPath, @maxConcurrentDownloads, @preferredQuality,
        @searchOrders, @createUserFolders, @overwriteExisting, @darkMode, @showNotifications)
      ON CONFLICT(id) DO UPDATE SET
        downloadPath=@downloadPath, maxConcurrentDownloads=@maxConcurrentDownloads,
        preferredQuality=@preferredQuality, searchOrders=@searchOrders,
        createUserFolders=@createUserFolders, overwriteExisting=@overwriteExisting,
        darkMode=@darkMode, showNotifications=@showNotifications
    `).run({
      downloadPath: s.downloadPath,
      maxConcurrentDownloads: s.maxConcurrentDownloads,
      preferredQuality: s.preferredQuality,
      searchOrders: JSON.stringify(s.searchOrders),
      createUserFolders: s.createUserFolders ? 1 : 0,
      overwriteExisting: s.overwriteExisting ? 1 : 0,
      darkMode: s.darkMode ? 1 : 0,
      showNotifications: s.showNotifications ? 1 : 0
    })
  }

  getSettings(): Settings {
    const r = this.db.prepare('SELECT * FROM settings WHERE id = 1').get() as Record<string, unknown>
    return {
      downloadPath: String(r.downloadPath ?? ''),
      maxConcurrentDownloads: Number(r.maxConcurrentDownloads ?? 4),
      preferredQuality: (r.preferredQuality as Settings['preferredQuality']) ?? 'hd',
      searchOrders: JSON.parse(String(r.searchOrders ?? '["best"]')),
      createUserFolders: !!r.createUserFolders,
      overwriteExisting: !!r.overwriteExisting,
      darkMode: !!r.darkMode,
      showNotifications: !!r.showNotifications
    }
  }

  updateSettings(s: Settings): void {
    this.writeSettings(s)
  }

  getUserToken(): string | undefined {
    const r = this.db.prepare('SELECT token FROM tokens WHERE id = 1').get() as { token?: string } | undefined
    return r?.token || undefined
  }

  setUserToken(t: string): void {
    this.db.prepare('INSERT INTO tokens (id, token) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET token = ?').run(t, t)
  }

  clearUserToken(): void {
    this.db.prepare('DELETE FROM tokens WHERE id = 1').run()
  }

  hasDownloaded(username: string, contentId: string): boolean {
    const q = username
      ? this.db.prepare('SELECT 1 FROM downloads WHERE username = ? AND content_id = ?').get(username, contentId)
      : this.db.prepare('SELECT 1 FROM downloads WHERE content_id = ?').get(contentId)
    return !!q
  }

  addRecord(r: Omit<DownloadRecord, 'id'>): DownloadRecord {
    const info = this.db.prepare(`
      INSERT INTO downloads (username, content_id, content_name, file_path, file_size,
        duration, width, height, has_audio, downloaded_at, thumbnail, search_order, rank)
      VALUES (@username, @contentId, @contentName, @filePath, @fileSize, @duration, @width,
        @height, @hasAudio, @downloadedAt, @thumbnail, @searchOrder, @rank)
      ON CONFLICT(username, content_id) DO UPDATE SET
        file_path=@filePath, file_size=@fileSize, downloaded_at=@downloadedAt
    `).run({
      username: r.username, contentId: r.contentId, contentName: r.contentName,
      filePath: r.filePath, fileSize: r.fileSize, duration: r.duration, width: r.width,
      height: r.height, hasAudio: r.hasAudio ? 1 : 0, downloadedAt: r.downloadedAt,
      thumbnail: r.thumbnail, searchOrder: r.searchOrder, rank: r.rank
    })
    return { ...r, id: Number(info.lastInsertRowid) }
  }

  getHistory(username?: string, limit = 100): DownloadRecord[] {
    const rows = (username
      ? this.db.prepare('SELECT * FROM downloads WHERE username = ? ORDER BY downloaded_at DESC LIMIT ?').all(username, limit)
      : this.db.prepare('SELECT * FROM downloads ORDER BY downloaded_at DESC LIMIT ?').all(limit)) as Record<string, unknown>[]
    return rows.map(this.rowToRecord)
  }

  private rowToRecord = (r: Record<string, unknown>): DownloadRecord => ({
    id: Number(r.id), username: String(r.username), contentId: String(r.content_id),
    contentName: String(r.content_name ?? ''), filePath: String(r.file_path ?? ''),
    fileSize: Number(r.file_size ?? 0), duration: Number(r.duration ?? 0),
    width: Number(r.width ?? 0), height: Number(r.height ?? 0), hasAudio: !!r.has_audio,
    downloadedAt: Number(r.downloaded_at ?? 0), thumbnail: String(r.thumbnail ?? ''),
    searchOrder: String(r.search_order ?? ''), rank: Number(r.rank ?? 0)
  })

  getStats(): Statistics {
    const agg = this.db.prepare('SELECT COUNT(*) n, COALESCE(SUM(file_size),0) size FROM downloads').get() as { n: number; size: number }
    const users = this.db.prepare('SELECT COUNT(DISTINCT username) n FROM downloads').get() as { n: number }
    const top = this.db.prepare(`
      SELECT username, COUNT(*) downloads, COALESCE(SUM(file_size),0) size
      FROM downloads GROUP BY username ORDER BY downloads DESC LIMIT 5
    `).all() as { username: string; downloads: number; size: number }[]
    return {
      totalDownloads: agg.n, totalSize: agg.size, totalUsers: users.n, totalCollections: 0,
      recentDownloads: this.getHistory(undefined, 10), topUsers: top
    }
  }

  close(): void {
    this.db.close()
  }
}

// Keep the settings column list referenced for future migrations.
void SETTINGS_COLS
```

- [ ] **Step 2: Delete the old JSON store.**

Run: `git rm desktop/src/main/store.ts`

- [ ] **Step 3: Write the test.**

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { SqliteStorage } from './storage'

let s: SqliteStorage
afterEach(() => s?.close())

describe('SqliteStorage', () => {
  it('round-trips settings', () => {
    s = new SqliteStorage(':memory:', { downloadPath: '/tmp/x' })
    expect(s.getSettings().downloadPath).toBe('/tmp/x')
    s.updateSettings({ ...s.getSettings(), maxConcurrentDownloads: 9 })
    expect(s.getSettings().maxConcurrentDownloads).toBe(9)
  })

  it('records downloads, dedupes, and aggregates stats', () => {
    s = new SqliteStorage(':memory:')
    const base = { contentName: 'a', filePath: '/p', fileSize: 100, duration: 1, width: 2,
      height: 3, hasAudio: false, downloadedAt: 1000, thumbnail: '', searchOrder: 'best', rank: 1 }
    s.addRecord({ username: 'bob', contentId: 'g1', ...base })
    expect(s.hasDownloaded('bob', 'g1')).toBe(true)
    expect(s.hasDownloaded('bob', 'g2')).toBe(false)
    const stats = s.getStats()
    expect(stats.totalDownloads).toBe(1)
    expect(stats.totalSize).toBe(100)
    expect(stats.topUsers[0]).toEqual({ username: 'bob', downloads: 1, size: 100 })
  })

  it('persists and clears the user token', () => {
    s = new SqliteStorage(':memory:')
    expect(s.getUserToken()).toBeUndefined()
    s.setUserToken('tok')
    expect(s.getUserToken()).toBe('tok')
    s.clearUserToken()
    expect(s.getUserToken()).toBeUndefined()
  })
})
```

- [ ] **Step 4: Run under Electron ABI.**

Run: `cd desktop && npm run test:main`
Expected: 3 passing.

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/main/storage.ts desktop/src/main/storage.test.ts
git rm desktop/src/main/store.ts
git commit -m "feat(desktop): SqliteStorage behind Storage interface"
```

---

## Task 3: RedgifsApi client

**Files:**
- Create: `desktop/src/main/api.ts`
- Test: `desktop/src/main/api.test.ts`

- [ ] **Step 1: Write `api.ts`.**

```ts
import type {
  Collection, Content, ContentResponse, UserProfile, UserResult
} from '../shared/types'
import { RateLimiter } from './ratelimit'

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
  private rl = new RateLimiter(120)

  setUserToken(token: string): void { this.userToken = token }
  clearUserToken(): void { this.userToken = '' }
  isAuthenticated(): boolean { return this.userToken !== '' }

  private async token(): Promise<string> {
    if (this.userToken) return this.userToken
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
```

- [ ] **Step 2: Write the test** (pure conversion — no network).

```ts
import { describe, it, expect } from 'vitest'
import { toContent, toContentResponse } from './api'

describe('api conversion', () => {
  it('maps a raw gif to Content', () => {
    const c = toContent({
      id: 'g1', createDate: 1, hasAudio: true, width: 1920, height: 1080, likes: 5, views: 9,
      duration: 12, urls: { hd: 'h.mp4', sd: 's.mp4', thumbnail: 't.jpg' }, userName: 'bob',
      description: 'hi', tags: ['a'], niches: []
    } as any)
    expect(c).toMatchObject({ id: 'g1', username: 'bob', hasAudio: true, urls: { hd: 'h.mp4' } })
  })

  it('maps a content response with pagination fields', () => {
    const r = toContentResponse({ gifs: [], page: 2, pages: 5, total: 400 } as any)
    expect(r).toEqual({ contents: [], page: 2, pages: 5, total: 400 })
  })
})
```

- [ ] **Step 3: Run — verify pass.**

Run: `cd desktop && npm test -- api`
Expected: 2 passing.

- [ ] **Step 4: Commit.**

```bash
git add desktop/src/main/api.ts desktop/src/main/api.test.ts
git commit -m "feat(desktop): RedgifsApi client with anon token and conversion"
```

---

## Task 4: Downloader — helpers (TDD) + engine

**Files:**
- Create: `desktop/src/main/downloader.ts`
- Test: `desktop/src/main/downloader.test.ts`

- [ ] **Step 1: Write the failing test for pure helpers.**

```ts
import { describe, it, expect } from 'vitest'
import { buildFilename, extFromUrl, pickUrl } from './downloader'

describe('downloader helpers', () => {
  it('parses extension and strips query strings', () => {
    expect(extFromUrl('https://x/AbC.mp4?token=1')).toBe('mp4')
    expect(extFromUrl('https://x/noext')).toBe('mp4')
  })

  it('builds a zero-padded sanitized filename', () => {
    expect(buildFilename({ id: 'g1', username: 'bo/b', urls: { hd: 'h.mp4' } } as any, 7))
      .toBe('0007_g1_bo_b.mp4')
  })

  it('picks hd then sd based on quality', () => {
    const urls = { hd: 'h.mp4', sd: 's.mp4' }
    expect(pickUrl({ urls } as any, 'hd')).toBe('h.mp4')
    expect(pickUrl({ urls: { sd: 's.mp4' } } as any, 'hd')).toBe('s.mp4')
    expect(pickUrl({ urls } as any, 'sd')).toBe('s.mp4')
  })
})
```

- [ ] **Step 2: Run — verify it fails.**

Run: `cd desktop && npm test -- downloader`
Expected: FAIL (module/exports not defined).

- [ ] **Step 3: Write `downloader.ts`.**

```ts
import { createWriteStream } from 'fs'
import { mkdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import { randomUUID } from 'crypto'
import type {
  Content, DownloadRequest, DownloadTask, Quality, Settings
} from '../shared/types'
import type { RedgifsApi } from './api'
import type { Storage } from './storage'
import { RateLimiter } from './ratelimit'

export function extFromUrl(url: string): string {
  const path = url.split('?')[0]
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  if (dot > slash && dot !== -1) return path.slice(dot + 1)
  return 'mp4'
}

export function sanitize(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_')
}

export function pickUrl(c: Content, quality: Quality): string {
  const { hd, sd } = c.urls
  if (quality === 'sd') return sd || hd || ''
  return hd || sd || ''
}

export function buildFilename(c: Content, rank: number): string {
  const ext = extFromUrl(c.urls.hd || c.urls.sd || '')
  return sanitize(`${String(rank).padStart(4, '0')}_${c.id}_${c.username}.${ext}`)
}

export interface DownloaderDeps {
  api: RedgifsApi
  storage: Storage
  onUpdate: (task: DownloadTask) => void
  onProgress: (task: DownloadTask) => void
}

export class Downloader {
  private tasks = new Map<string, DownloadTask>()
  private aborters = new Map<string, AbortController>()
  private rl = new RateLimiter(150)

  constructor(private deps: DownloaderDeps) {}

  list(): DownloadTask[] {
    return [...this.tasks.values()]
  }

  start(request: DownloadRequest): DownloadTask {
    const settings = this.deps.storage.getSettings()
    const task: DownloadTask = {
      id: randomUUID(), type: request.type, username: request.username ?? '',
      status: 'queued', progress: 0, totalItems: 0, downloaded: 0, failed: 0, skipped: 0,
      currentItem: '', downloadPath: this.pathFor(request, settings), startTime: Date.now()
    }
    this.tasks.set(task.id, task)
    this.aborters.set(task.id, new AbortController())
    void this.run(task, request, settings)
    return task
  }

  pause(id: string): void {
    const t = this.tasks.get(id)
    if (t && t.status === 'downloading') { this.setStatus(t, 'paused'); this.abort(id) }
  }

  resume(id: string): void {
    const t = this.tasks.get(id)
    if (!t || t.status !== 'paused') return
    this.aborters.set(id, new AbortController())
    const req = { type: t.type, username: t.username, quality: undefined } as DownloadRequest
    void this.run(t, req, this.deps.storage.getSettings())
  }

  cancel(id: string): void {
    const t = this.tasks.get(id)
    if (!t) return
    this.setStatus(t, 'cancelled')
    t.endTime = Date.now()
    this.abort(id)
  }

  private abort(id: string): void {
    this.aborters.get(id)?.abort()
  }

  private pathFor(req: DownloadRequest, s: Settings): string {
    if (req.targetPath) return req.targetPath
    const base = s.downloadPath
    if (req.type === 'user') return s.createUserFolders ? join(base, 'users', req.username ?? '') : join(base, req.username ?? '')
    if (req.type === 'collection') return join(base, 'collections', req.collectionId ?? '')
    if (req.type === 'likes') return join(base, 'likes')
    return base
  }

  private setStatus(t: DownloadTask, status: DownloadTask['status']): void {
    t.status = status
    this.deps.onUpdate({ ...t })
  }

  private async resolveContent(req: DownloadRequest, s: Settings): Promise<Content[]> {
    const seen = new Map<string, Content>()
    const addAll = (items: Content[]): void => { for (const c of items) if (!seen.has(c.id)) seen.set(c.id, c) }
    if (req.type === 'user') {
      const orders = req.searchOrders?.length ? req.searchOrders : s.searchOrders
      for (const order of orders) {
        let page = 1
        while (true) {
          const r = await this.deps.api.getUserContent(req.username ?? '', order, page)
          addAll(r.contents)
          if (page >= r.pages || r.contents.length === 0) break
          page++
        }
      }
    } else if (req.type === 'likes') {
      let page = 1
      while (true) {
        const r = await this.deps.api.getLikes(page)
        addAll(r.contents)
        if (page >= r.pages || r.contents.length === 0) break
        page++
      }
    } else if (req.type === 'collection') {
      let page = 1
      while (true) {
        const r = await this.deps.api.getCollectionContent(req.collectionId ?? '', page)
        addAll(r.contents)
        if (page >= r.pages || r.contents.length === 0) break
        page++
      }
    } else if (req.type === 'single') {
      for (const id of req.contentIds ?? []) addAll([await this.deps.api.getGif(id)])
    }
    return [...seen.values()]
  }

  private async run(task: DownloadTask, req: DownloadRequest, s: Settings): Promise<void> {
    this.setStatus(task, 'downloading')
    let content: Content[]
    try {
      content = await this.resolveContent(req, s)
    } catch (e) {
      task.error = (e as Error).message
      this.setStatus(task, 'failed')
      task.endTime = Date.now()
      return
    }
    task.totalItems = content.length
    const quality: Quality = req.quality ?? s.preferredQuality
    const signal = this.aborters.get(task.id)!.signal

    let index = 0
    const worker = async (): Promise<void> => {
      while (index < content.length) {
        if (signal.aborted || task.status !== 'downloading') return
        const i = index++
        const c = content[i]
        task.currentItem = c.id
        if (!s.overwriteExisting && this.deps.storage.hasDownloaded(task.username, c.id)) {
          task.skipped++
        } else {
          try {
            await this.downloadOne(task, c, i + 1, quality, s, signal, req.searchOrders?.[0] ?? s.searchOrders[0] ?? '')
            task.downloaded++
          } catch {
            task.failed++
          }
        }
        task.progress = Math.round(((task.downloaded + task.failed + task.skipped) / task.totalItems) * 100)
        this.deps.onProgress({ ...task })
      }
    }
    const pool = Array.from({ length: Math.max(1, s.maxConcurrentDownloads) }, () => worker())
    await Promise.all(pool)

    if (task.status === 'downloading') {
      this.setStatus(task, 'completed')
      task.endTime = Date.now()
    }
  }

  private async downloadOne(task: DownloadTask, c: Content, rank: number, quality: Quality,
    s: Settings, signal: AbortSignal, order: string): Promise<void> {
    const url = pickUrl(c, quality)
    if (!url) throw new Error('no url')
    await mkdir(task.downloadPath, { recursive: true })
    const filename = buildFilename(c, rank)
    const finalPath = join(task.downloadPath, filename)
    const tmpPath = finalPath + '.tmp'
    await this.rl.wait()
    const resp = await fetch(url, { signal, headers: { 'User-Agent': 'RedGifs-Downloader/4.0' } })
    if (!resp.ok || !resp.body) throw new Error(`download HTTP ${resp.status}`)
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(tmpPath)
      Readable.fromWeb(resp.body as any).pipe(out)
      out.on('finish', resolve)
      out.on('error', reject)
    })
    const size = (await stat(tmpPath)).size
    await rename(tmpPath, finalPath).catch(async (e) => { await rm(tmpPath, { force: true }); throw e })
    this.deps.storage.addRecord({
      username: task.username || c.username, contentId: c.id, contentName: filename,
      filePath: finalPath, fileSize: size, duration: c.duration, width: c.width, height: c.height,
      hasAudio: c.hasAudio, downloadedAt: Date.now(), thumbnail: c.urls.thumbnail ?? '',
      searchOrder: order, rank
    })
  }
}
```

- [ ] **Step 4: Run — verify helper tests pass.**

Run: `cd desktop && npm test -- downloader`
Expected: 3 passing.

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/main/downloader.ts desktop/src/main/downloader.test.ts
git commit -m "feat(desktop): download engine with concurrency and dedupe"
```

---

## Task 5: IPC wiring + app entry

**Files:**
- Create: `desktop/src/main/ipc.ts`
- Create: `desktop/src/main/index.ts`
- Verify: `desktop/src/preload/index.ts` (exists), `desktop/src/shared/ipc.ts` (exists)

- [ ] **Step 1: Write `ipc.ts`.**

```ts
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
```

- [ ] **Step 2: Write `index.ts`.**

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { SqliteStorage } from './storage'
import { registerIpc } from './ipc'

let storage: SqliteStorage

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 940, minHeight: 640,
    backgroundColor: '#0f172a', show: false, autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  win.on('ready-to-show', () => win.show())

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
```

- [ ] **Step 3: Typecheck.**

Run: `cd desktop && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add desktop/src/main/ipc.ts desktop/src/main/index.ts
git commit -m "feat(desktop): IPC handlers and app entry"
```

---

## Task 6: Renderer — shell, API hook, pages

**Files:**
- Create: `desktop/src/renderer/index.html`
- Create: `desktop/src/renderer/src/main.tsx`
- Create: `desktop/src/renderer/src/App.tsx`
- Create: `desktop/src/renderer/src/styles.css`
- Create: `desktop/src/renderer/src/pages/Browse.tsx`
- Create: `desktop/src/renderer/src/pages/Downloads.tsx`
- Create: `desktop/src/renderer/src/pages/SettingsPage.tsx`
- Create: `desktop/src/renderer/src/components/Toasts.tsx`

- [ ] **Step 1: `index.html`.**

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src * data:; style-src 'self' 'unsafe-inline'; connect-src *" />
    <title>RedGifs Downloader</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: `main.tsx`.**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 3: `App.tsx`** — nav shell + page routing + toast wiring.

```tsx
import { useEffect, useState } from 'react'
import Browse from './pages/Browse'
import Downloads from './pages/Downloads'
import SettingsPage from './pages/SettingsPage'
import Toasts, { useToasts } from './components/Toasts'

type Page = 'browse' | 'downloads' | 'settings'
const NAV: { id: Page; label: string }[] = [
  { id: 'browse', label: 'Browse' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'settings', label: 'Settings' }
]

export default function App(): JSX.Element {
  const [page, setPage] = useState<Page>('browse')
  const toasts = useToasts()

  useEffect(() => {
    const off = window.api.on('evt:toast', (t) => toasts.push(t.message, t.type))
    return off
  }, [])

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

- [ ] **Step 4: `components/Toasts.tsx`.**

```tsx
import { useCallback, useState } from 'react'
import type { ToastType } from '@shared/types'

interface Toast { id: number; message: string; type: ToastType }

export function useToasts() {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, message, type }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 5000)
  }, [])
  return { items, push }
}

export default function Toasts({ items }: { items: Toast[] }): JSX.Element {
  return (
    <div className="toasts">
      {items.map((t) => <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>)}
    </div>
  )
}
```

- [ ] **Step 5: `pages/Browse.tsx`** — search a user, show grid, download all.

```tsx
import { useState } from 'react'
import type { Content, ToastType } from '@shared/types'

export default function Browse({ notify }: { notify: (m: string, t?: ToastType) => void }): JSX.Element {
  const [username, setUsername] = useState('')
  const [order, setOrder] = useState('best')
  const [items, setItems] = useState<Content[]>([])
  const [loading, setLoading] = useState(false)

  async function search(): Promise<void> {
    if (!username.trim()) return
    setLoading(true)
    try {
      const r = await window.api.getUserContent(username.trim(), order, 1)
      setItems(r.contents)
      if (r.contents.length === 0) notify('No results', 'info')
    } catch (e) {
      notify('Search failed: ' + (e as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function downloadAll(): Promise<void> {
    try {
      await window.api.startDownload({ type: 'user', username: username.trim(), searchOrders: [order] })
      notify('Download started for ' + username, 'success')
    } catch (e) {
      notify('Download failed: ' + (e as Error).message, 'error')
    }
  }

  return (
    <div className="page">
      <h1>Browse Users</h1>
      <div className="toolbar">
        <input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()} />
        <select value={order} onChange={(e) => setOrder(e.target.value)}>
          {['best', 'recent', 'top', 'trending'].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button className="btn" onClick={search} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
        {items.length > 0 && <button className="btn btn-primary" onClick={downloadAll}>Download All</button>}
      </div>
      <div className="grid">
        {items.map((c) => (
          <div key={c.id} className="card">
            {c.urls.thumbnail && <img src={c.urls.thumbnail} loading="lazy" alt="" />}
            <div className="card-meta">{c.views.toLocaleString()} views</div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: `pages/Downloads.tsx`** — live task queue.

```tsx
import { useEffect, useState } from 'react'
import type { DownloadTask } from '@shared/types'

export default function Downloads(): JSX.Element {
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const refresh = (): void => { window.api.listDownloads().then(setTasks) }

  useEffect(() => {
    refresh()
    const upsert = (t: DownloadTask): void =>
      setTasks((xs) => { const i = xs.findIndex((x) => x.id === t.id); if (i === -1) return [...xs, t]; const c = xs.slice(); c[i] = t; return c })
    const offP = window.api.on('evt:download:progress', upsert)
    const offU = window.api.on('evt:download:updated', upsert)
    return () => { offP(); offU() }
  }, [])

  if (tasks.length === 0) return <div className="page"><h1>Downloads</h1><p className="empty">No active downloads</p></div>

  return (
    <div className="page">
      <h1>Downloads</h1>
      {tasks.map((t) => (
        <div key={t.id} className="task">
          <div className="task-head">
            <strong>{t.username || t.id.slice(0, 8)}</strong>
            <span className={`status status-${t.status}`}>{t.status}</span>
            <span className="grow" />
            {t.status === 'downloading' && <button className="btn btn-sm" onClick={() => window.api.pauseDownload(t.id)}>Pause</button>}
            {t.status === 'paused' && <button className="btn btn-sm" onClick={() => window.api.resumeDownload(t.id)}>Resume</button>}
            {(t.status === 'downloading' || t.status === 'paused' || t.status === 'queued') &&
              <button className="btn btn-sm btn-danger" onClick={() => window.api.cancelDownload(t.id)}>Cancel</button>}
          </div>
          <div className="progress"><div className="progress-bar" style={{ width: `${t.progress}%` }} /></div>
          <div className="task-meta">{t.downloaded}/{t.totalItems} · {t.failed} failed · {t.skipped} skipped</div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 7: `pages/SettingsPage.tsx`.**

```tsx
import { useEffect, useState } from 'react'
import type { Settings, ToastType } from '@shared/types'

export default function SettingsPage({ notify }: { notify: (m: string, t?: ToastType) => void }): JSX.Element {
  const [s, setS] = useState<Settings | null>(null)
  useEffect(() => { window.api.getSettings().then(setS) }, [])
  if (!s) return <div className="page"><h1>Settings</h1></div>

  const set = <K extends keyof Settings>(k: K, v: Settings[K]): void => setS({ ...s, [k]: v })

  async function save(): Promise<void> {
    try { await window.api.updateSettings(s!); notify('Settings saved', 'success') }
    catch (e) { notify('Save failed: ' + (e as Error).message, 'error') }
  }
  async function pick(): Promise<void> {
    const p = await window.api.pickFolder(); if (p) set('downloadPath', p)
  }

  return (
    <div className="page">
      <h1>Settings</h1>
      <label>Download folder
        <div className="row"><input value={s.downloadPath} onChange={(e) => set('downloadPath', e.target.value)} />
          <button className="btn" onClick={pick}>Browse…</button></div>
      </label>
      <label>Max concurrent downloads
        <input type="number" min={1} max={16} value={s.maxConcurrentDownloads}
          onChange={(e) => set('maxConcurrentDownloads', Number(e.target.value))} /></label>
      <label>Quality
        <select value={s.preferredQuality} onChange={(e) => set('preferredQuality', e.target.value as Settings['preferredQuality'])}>
          <option value="hd">HD</option><option value="sd">SD</option></select></label>
      <label className="check"><input type="checkbox" checked={s.createUserFolders}
        onChange={(e) => set('createUserFolders', e.target.checked)} /> Create per-user folders</label>
      <label className="check"><input type="checkbox" checked={s.overwriteExisting}
        onChange={(e) => set('overwriteExisting', e.target.checked)} /> Overwrite existing files</label>
      <button className="btn btn-primary" onClick={save}>Save</button>
    </div>
  )
}
```

- [ ] **Step 8: `styles.css`** — minimal dark theme (a full `frontend-design` pass comes in Phase 3).

```css
* { box-sizing: border-box; margin: 0; }
:root { --bg: #0f172a; --panel: #1e293b; --panel2: #273449; --text: #e2e8f0; --muted: #94a3b8; --accent: #3b82f6; --danger: #ef4444; --ok: #22c55e; }
body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; }
.app { display: grid; grid-template-columns: 220px 1fr; height: 100vh; }
.sidebar { background: var(--panel); padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.brand { font-weight: 700; font-size: 18px; display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.brand small { color: var(--muted); font-weight: 400; display: block; }
.brand-mark { background: var(--accent); width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; }
.nav-item { text-align: left; background: none; border: 0; color: var(--muted); padding: 10px 12px; border-radius: 8px; cursor: pointer; font-size: 14px; }
.nav-item:hover { background: var(--panel2); color: var(--text); }
.nav-item.active { background: var(--accent); color: #fff; }
.content { overflow-y: auto; }
.page { padding: 28px 32px; max-width: 1100px; }
.page h1 { font-size: 22px; margin-bottom: 18px; }
.toolbar { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
input, select { background: var(--panel2); border: 1px solid #334155; color: var(--text); padding: 9px 12px; border-radius: 8px; font-size: 14px; }
.row { display: flex; gap: 8px; }
.btn { background: var(--panel2); border: 1px solid #334155; color: var(--text); padding: 9px 14px; border-radius: 8px; cursor: pointer; font-size: 14px; }
.btn:hover { border-color: var(--accent); }
.btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn-danger { background: var(--danger); border-color: var(--danger); color: #fff; }
.btn-sm { padding: 5px 10px; font-size: 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
.card { background: var(--panel); border-radius: 10px; overflow: hidden; }
.card img { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; }
.card-meta { padding: 8px 10px; font-size: 12px; color: var(--muted); }
.empty { color: var(--muted); }
.task { background: var(--panel); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
.task-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.grow { flex: 1; }
.status { font-size: 12px; color: var(--muted); }
.status-completed { color: var(--ok); } .status-failed, .status-cancelled { color: var(--danger); }
.progress { height: 8px; background: var(--panel2); border-radius: 999px; overflow: hidden; }
.progress-bar { height: 100%; background: var(--accent); transition: width .2s; }
.task-meta { font-size: 12px; color: var(--muted); margin-top: 8px; }
label { display: block; margin-bottom: 16px; font-size: 14px; color: var(--muted); }
label input:not([type=checkbox]), label select { display: block; margin-top: 6px; width: 100%; max-width: 420px; }
label.check { display: flex; align-items: center; gap: 8px; }
label.check input { margin: 0; }
.toasts { position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; }
.toast { padding: 12px 16px; border-radius: 8px; background: var(--panel2); border-left: 3px solid var(--muted); font-size: 14px; }
.toast-success { border-color: var(--ok); } .toast-error { border-color: var(--danger); }
```

- [ ] **Step 9: Typecheck.**

Run: `cd desktop && npm run typecheck`
Expected: no errors.

- [ ] **Step 10: Commit.**

```bash
git add desktop/src/renderer
git commit -m "feat(desktop): React renderer shell, browse, downloads, settings"
```

---

## Task 7: End-to-end verification

- [ ] **Step 1: Run all unit tests.**

Run: `cd desktop && npm test && npm run test:main`
Expected: all green.

- [ ] **Step 2: Launch the app.**

Run: `cd desktop && npm run dev`
Expected: window opens, no console errors.

- [ ] **Step 3: Manual smoke test.**
  - Browse → enter a known RedGifs username → Search → thumbnails appear.
  - Click Download All → switch to Downloads → progress bar advances, counts update live.
  - Confirm files land in the configured download folder.
  - Settings → change folder + concurrency → Save → reopen app → values persist.

- [ ] **Step 4: Commit any fixes, then tag Phase 1 done.**

```bash
git add -A
git commit -m "chore(desktop): Phase 1 MVP verified"
```

---

## Out of scope (later phases)

- **Phase 2:** real in-app login token capture (`AuthManager` + webRequest sniff), `authStatus`/profile UI, likes + private collections pages. The IPC auth handlers are stubbed here so the contract is stable.
- **Phase 3:** history view, statistics dashboard, ranked-filename/thumbnail parity, adaptive-backoff tuning, dedicated `frontend-design` visual pass, and removal of the Go implementation.
```
