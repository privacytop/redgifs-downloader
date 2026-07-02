import Database from 'better-sqlite3'
import {
  DEFAULT_SETTINGS,
  type Content,
  type DownloadRecord,
  type Settings,
  type Statistics
} from '../shared/types'

export type CacheSource = { type: 'collection' | 'liked'; id: string }

export interface CacheFilter {
  tags?: string[]
  sources?: CacheSource[]
  likedOnly?: boolean
}

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
  cacheContents(contents: Content[], source: CacheSource): void
  searchCachedGifs(filter: CacheFilter): Content[]
  /** Collection ids known (from cached views) to contain this gif. */
  gifCollectionIds(gifId: string): string[]
  /** Drop a cached membership row (e.g. after removing a gif from a collection). */
  removeGifMembership(gifId: string, sourceType: string, sourceId: string): void
  close(): void
}

export class SqliteStorage implements Storage {
  private db: Database.Database

  // `defaults` is applied only on first run (when no settings row exists yet);
  // once a settings row is persisted, that row wins over these defaults.
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
      CREATE TABLE IF NOT EXISTS gif_cache (
        id TEXT PRIMARY KEY, username TEXT, data TEXT NOT NULL, tags TEXT, cached_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS gif_membership (
        gif_id TEXT, source_type TEXT, source_id TEXT,
        UNIQUE(gif_id, source_type, source_id)
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

  private parseSearchOrders(raw: unknown): string[] {
    try {
      const v = JSON.parse(String(raw ?? ''))
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v
    } catch {
      // fall through to defaults
    }
    return DEFAULT_SETTINGS.searchOrders
  }

  getSettings(): Settings {
    const r = this.db.prepare('SELECT * FROM settings WHERE id = 1').get() as Record<string, unknown>
    return {
      downloadPath: String(r.downloadPath ?? ''),
      maxConcurrentDownloads: Number(r.maxConcurrentDownloads ?? 4),
      preferredQuality: (r.preferredQuality as Settings['preferredQuality']) ?? 'hd',
      searchOrders: this.parseSearchOrders(r.searchOrders),
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

  cacheContents(contents: Content[], source: CacheSource): void {
    const upsertGif = this.db.prepare(`
      INSERT OR REPLACE INTO gif_cache (id, username, data, tags, cached_at)
      VALUES (@id, @username, @data, @tags, @cachedAt)
    `)
    const upsertMembership = this.db.prepare(`
      INSERT OR IGNORE INTO gif_membership (gif_id, source_type, source_id)
      VALUES (@gifId, @sourceType, @sourceId)
    `)
    const now = Date.now()
    const tx = this.db.transaction((items: Content[]) => {
      for (const c of items) {
        upsertGif.run({
          id: c.id,
          username: c.username ?? '',
          data: JSON.stringify(c),
          tags: JSON.stringify(c.tags ?? []),
          cachedAt: now
        })
        upsertMembership.run({ gifId: c.id, sourceType: source.type, sourceId: source.id })
      }
    })
    tx(contents)
  }

  searchCachedGifs(filter: CacheFilter): Content[] {
    const sources = filter.sources ?? []
    const clauses: string[] = []
    const params: unknown[] = []

    // Membership in ALL given sources (AND semantics).
    for (const src of sources) {
      clauses.push(
        'EXISTS (SELECT 1 FROM gif_membership m WHERE m.gif_id = gif_cache.id AND m.source_type = ? AND m.source_id = ?)'
      )
      params.push(src.type, src.id)
    }

    if (filter.likedOnly) {
      clauses.push(
        "EXISTS (SELECT 1 FROM gif_membership m WHERE m.gif_id = gif_cache.id AND m.source_type = 'liked')"
      )
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db
      .prepare(`SELECT data FROM gif_cache ${where}`)
      .all(...params) as { data: string }[]

    const wantedTags = (filter.tags ?? []).map((t) => t.toLowerCase())
    const out: Content[] = []
    for (const row of rows) {
      let content: Content
      try {
        content = JSON.parse(row.data) as Content
      } catch {
        continue
      }
      if (wantedTags.length) {
        const gifTags = (content.tags ?? []).map((t) => t.toLowerCase())
        const hasAll = wantedTags.every((t) => gifTags.includes(t))
        if (!hasAll) continue
      }
      out.push(content)
    }
    return out
  }

  gifCollectionIds(gifId: string): string[] {
    const rows = this.db
      .prepare("SELECT source_id FROM gif_membership WHERE gif_id = ? AND source_type = 'collection'")
      .all(gifId) as { source_id: string }[]
    return rows.map((r) => r.source_id)
  }

  removeGifMembership(gifId: string, sourceType: string, sourceId: string): void {
    this.db
      .prepare('DELETE FROM gif_membership WHERE gif_id = ? AND source_type = ? AND source_id = ?')
      .run(gifId, sourceType, sourceId)
  }

  close(): void {
    this.db.close()
  }
}
