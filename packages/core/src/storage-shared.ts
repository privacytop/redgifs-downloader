import type { Content, DownloadRecord } from './types'

/**
 * The SQLite schema shared by both platforms' storage layers. Desktop runs it
 * via better-sqlite3, mobile via @capacitor-community/sqlite — the DDL is
 * identical, so it lives here once.
 */
export const SCHEMA = `
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
`

/** Map a raw `downloads` row (snake_case columns) to a DownloadRecord. */
export function rowToRecord(r: Record<string, unknown>): DownloadRecord {
  return {
    id: Number(r.id),
    username: String(r.username),
    contentId: String(r.content_id),
    contentName: String(r.content_name ?? ''),
    filePath: String(r.file_path ?? ''),
    fileSize: Number(r.file_size ?? 0),
    duration: Number(r.duration ?? 0),
    width: Number(r.width ?? 0),
    height: Number(r.height ?? 0),
    hasAudio: !!r.has_audio,
    downloadedAt: Number(r.downloaded_at ?? 0),
    thumbnail: String(r.thumbnail ?? ''),
    searchOrder: String(r.search_order ?? ''),
    rank: Number(r.rank ?? 0)
  }
}

/**
 * Post-filter cached gif rows (already narrowed by source in SQL) by required
 * tags — AND semantics, case-insensitive. Rows whose JSON fails to parse are
 * dropped. Shared so desktop and mobile filter identically.
 */
export function filterCachedRows(rows: { data: string }[], tags?: string[]): Content[] {
  const wanted = (tags ?? []).map((t) => t.toLowerCase())
  const out: Content[] = []
  for (const row of rows) {
    let content: Content
    try {
      content = JSON.parse(row.data) as Content
    } catch {
      continue
    }
    if (wanted.length) {
      const gifTags = (content.tags ?? []).map((t) => t.toLowerCase())
      if (!wanted.every((t) => gifTags.includes(t))) continue
    }
    out.push(content)
  }
  return out
}
