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
