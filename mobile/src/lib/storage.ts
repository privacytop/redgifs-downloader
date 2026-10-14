import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import { SCHEMA, rowToRecord, type Content, type DownloadRecord } from '@redloader/core'
import { LIBRARY_ORDER_BY, buildLibraryWhere, likeEscape, type LibraryQuery } from './libraryQuery'

export type { LibraryQuery, LibrarySort } from './libraryQuery'
export type CacheSource = { type: 'collection' | 'liked'; id: string }

export interface LibraryPage {
  items: Content[]
  total: number
}

export interface TagCount {
  tag: string
  /** Display casing (as the API spelled it). */
  label: string
  count: number
}

const DB_NAME = 'redloader'
const SCHEMA_VERSION = 2

// Mobile-only additions on top of the shared SCHEMA: denormalised columns so
// the index can be filtered/sorted in SQL instead of parsing every row's JSON,
// and a tag table for indexed tag lookups.
const MOBILE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS gif_tags (
    gif_id TEXT NOT NULL, tag TEXT NOT NULL, label TEXT,
    UNIQUE(gif_id, tag)
  );
  CREATE INDEX IF NOT EXISTS idx_gif_tags_tag ON gif_tags(tag);
  CREATE INDEX IF NOT EXISTS idx_gif_tags_gif ON gif_tags(gif_id);
`
const EXTRA_COLUMNS: Array<[string, string]> = [
  ['title', 'TEXT'],
  ['views', 'INTEGER'],
  ['likes', 'INTEGER'],
  ['duration', 'REAL'],
  ['create_date', 'INTEGER']
]
const COLUMN_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_gif_cache_views ON gif_cache(views);
  CREATE INDEX IF NOT EXISTS idx_gif_cache_likes ON gif_cache(likes);
  CREATE INDEX IF NOT EXISTS idx_gif_cache_created ON gif_cache(create_date);
  CREATE INDEX IF NOT EXISTS idx_gif_cache_username ON gif_cache(username);
`

type Row = Record<string, unknown>

/**
 * Async sqlite storage for the mobile app — the metadata index (gif cache +
 * membership + tags) plus download history. Uses the same base schema and row
 * transforms as desktop (@redloader/core). @capacitor-community/sqlite is
 * async, hence every method returns a Promise.
 */
class MobileStorage {
  private conn: SQLiteConnection
  private db: SQLiteDBConnection | null = null
  private opening: Promise<SQLiteDBConnection> | null = null

  constructor() {
    this.conn = new SQLiteConnection(CapacitorSQLite)
  }

  /** Open (once) + migrate. Deduped so concurrent callers share one open. */
  private async open(): Promise<SQLiteDBConnection> {
    if (this.db) return this.db
    if (this.opening) return this.opening
    // Clear the cached promise if the open REJECTS, so a transient first-open
    // failure (locked/uninitialised DB during cold start) can be retried
    // instead of poisoning every future storage call for the whole session.
    this.opening = (async () => {
      const ret = await this.conn.checkConnectionsConsistency().catch(() => ({ result: false }))
      const isConn = (await this.conn.isConnection(DB_NAME, false)).result
      const db =
        ret.result && isConn
          ? await this.conn.retrieveConnection(DB_NAME, false)
          : await this.conn.createConnection(DB_NAME, false, 'no-encryption', 1, false)
      await db.open()
      await db.execute(SCHEMA)
      await this.migrate(db)
      this.db = db
      return db
    })()
    this.opening.catch(() => {
      this.opening = null
    })
    return this.opening
  }

  private async migrate(db: SQLiteDBConnection): Promise<void> {
    await db.execute(MOBILE_SCHEMA)
    const info = await db.query('PRAGMA table_info(gif_cache)')
    const have = new Set(((info.values ?? []) as Row[]).map((r) => String(r.name)))
    for (const [name, type] of EXTRA_COLUMNS) {
      if (!have.has(name)) await db.execute(`ALTER TABLE gif_cache ADD COLUMN ${name} ${type}`)
    }
    await db.execute(COLUMN_INDEXES)

    const ver = await db.query("SELECT value FROM kv WHERE key = 'schema_version'")
    const current = Number(((ver.values ?? []) as Row[])[0]?.value ?? 0)
    if (current >= SCHEMA_VERSION) return
    await this.backfill(db)
    await db.run("INSERT OR REPLACE INTO kv (key, value) VALUES ('schema_version', ?)", [String(SCHEMA_VERSION)])
  }

  /** Populate the new columns/tags for rows cached by older versions. */
  private async backfill(db: SQLiteDBConnection): Promise<void> {
    try {
      // Fast path: SQLite JSON1 does it in two statements.
      await db.execute(`
        UPDATE gif_cache SET
          title = COALESCE(json_extract(data, '$.title'), ''),
          views = COALESCE(json_extract(data, '$.views'), 0),
          likes = COALESCE(json_extract(data, '$.likes'), 0),
          duration = COALESCE(json_extract(data, '$.duration'), 0),
          create_date = COALESCE(json_extract(data, '$.createDate'), 0)
        WHERE views IS NULL;
        INSERT OR IGNORE INTO gif_tags (gif_id, tag, label)
          SELECT gif_cache.id, lower(j.value), j.value FROM gif_cache, json_each(gif_cache.tags) j;
      `)
    } catch {
      // No JSON1: do it in JS, in chunks, so a 10k-row index doesn't build one
      // giant statement set.
      const res = await db.query('SELECT id, data FROM gif_cache WHERE views IS NULL')
      const rows = (res.values ?? []) as { id: string; data: string }[]
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200)
        const statements = chunk.flatMap((r) => {
          let c: Content
          try {
            c = JSON.parse(r.data) as Content
          } catch {
            return []
          }
          return this.columnStatements(c)
        })
        if (statements.length) await db.executeSet(statements)
      }
    }
  }

  private columnStatements(c: Content): Array<{ statement: string; values: unknown[] }> {
    const tags = Array.from(new Set((c.tags ?? []).map((t) => t.trim()).filter(Boolean)))
    return [
      {
        statement: 'UPDATE gif_cache SET title=?, views=?, likes=?, duration=?, create_date=? WHERE id=?',
        values: [c.title ?? '', c.views ?? 0, c.likes ?? 0, c.duration ?? 0, c.createDate ?? 0, c.id]
      },
      { statement: 'DELETE FROM gif_tags WHERE gif_id = ?', values: [c.id] },
      ...tags.map((t) => ({
        statement: 'INSERT OR IGNORE INTO gif_tags (gif_id, tag, label) VALUES (?,?,?)',
        values: [c.id, t.toLowerCase(), t]
      }))
    ]
  }

  async cacheContents(contents: Content[], source: CacheSource): Promise<void> {
    if (!contents.length) return
    const db = await this.open()
    const now = Date.now()
    const statements = contents.flatMap((c) => [
      {
        statement:
          'INSERT OR REPLACE INTO gif_cache (id, username, data, tags, cached_at, title, views, likes, duration, create_date) VALUES (?,?,?,?,?,?,?,?,?,?)',
        values: [
          c.id, c.username ?? '', JSON.stringify(c), JSON.stringify(c.tags ?? []), now,
          c.title ?? '', c.views ?? 0, c.likes ?? 0, c.duration ?? 0, c.createDate ?? 0
        ]
      },
      // columnStatements also rewrites the tag rows; its UPDATE is redundant
      // after the INSERT but keeps one code path for backfill + insert.
      ...this.columnStatements(c).slice(1),
      {
        statement:
          'INSERT OR IGNORE INTO gif_membership (gif_id, source_type, source_id) VALUES (?,?,?)',
        values: [c.id, source.type, source.id]
      }
    ])
    await db.executeSet(statements as never)
  }

  /** One page of the offline index matching `q`, plus the total match count. */
  async queryLibrary(q: LibraryQuery, limit: number, offset: number): Promise<LibraryPage> {
    const db = await this.open()
    const { where, params } = buildLibraryWhere(q)
    const order = LIBRARY_ORDER_BY[q.sort ?? 'newest']
    const [rows, count] = await Promise.all([
      db.query(`SELECT g.data FROM gif_cache g ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, limit, offset] as never[]),
      db.query(`SELECT COUNT(*) n FROM gif_cache g ${where}`, params as never[])
    ])
    const items: Content[] = []
    for (const row of (rows.values ?? []) as { data: string }[]) {
      try {
        items.push(JSON.parse(row.data) as Content)
      } catch {
        /* skip corrupt row */
      }
    }
    return { items, total: Number(((count.values ?? []) as Row[])[0]?.n ?? 0) }
  }

  /** Most-used tags in the index (optionally filtered by prefix). */
  async libraryTags(limit = 60, prefix?: string): Promise<TagCount[]> {
    const db = await this.open()
    const where = prefix?.trim() ? "WHERE tag LIKE ? ESCAPE '\\'" : ''
    const params = prefix?.trim() ? [`${likeEscape(prefix.trim().toLowerCase())}%`, limit] : [limit]
    const res = await db.query(
      `SELECT tag, MIN(label) label, COUNT(*) n FROM gif_tags ${where} GROUP BY tag ORDER BY n DESC, tag ASC LIMIT ?`,
      params as never[]
    )
    return ((res.values ?? []) as Row[]).map((r) => ({
      tag: String(r.tag),
      label: String(r.label ?? r.tag),
      count: Number(r.n ?? 0)
    }))
  }

  async cachedCount(): Promise<number> {
    const db = await this.open()
    const res = await db.query('SELECT COUNT(*) n FROM gif_cache')
    return Number((res.values?.[0] as { n?: number })?.n ?? 0)
  }

  /** Every gif id the index knows as liked — seeds the heart state offline. */
  async likedIds(): Promise<string[]> {
    const db = await this.open()
    const res = await db.query("SELECT gif_id FROM gif_membership WHERE source_type = 'liked'")
    return ((res.values ?? []) as { gif_id: string }[]).map((r) => r.gif_id)
  }

  async gifCollectionIds(gifId: string): Promise<string[]> {
    const db = await this.open()
    const res = await db.query(
      "SELECT source_id FROM gif_membership WHERE gif_id = ? AND source_type = 'collection'",
      [gifId]
    )
    return ((res.values ?? []) as { source_id: string }[]).map((r) => r.source_id)
  }

  async addGifMembership(gifId: string, sourceType: string, sourceId: string): Promise<void> {
    const db = await this.open()
    await db.run(
      'INSERT OR IGNORE INTO gif_membership (gif_id, source_type, source_id) VALUES (?,?,?)',
      [gifId, sourceType, sourceId]
    )
  }

  async removeGifMembership(gifId: string, sourceType: string, sourceId: string): Promise<void> {
    const db = await this.open()
    await db.run(
      'DELETE FROM gif_membership WHERE gif_id = ? AND source_type = ? AND source_id = ?',
      [gifId, sourceType, sourceId]
    )
  }

  /** Drop the whole offline index (account switch). Download history is kept. */
  async clearIndex(): Promise<void> {
    const db = await this.open()
    await db.execute('DELETE FROM gif_tags; DELETE FROM gif_membership; DELETE FROM gif_cache;')
  }

  async addRecord(r: Omit<DownloadRecord, 'id'>): Promise<void> {
    const db = await this.open()
    await db.run(
      `INSERT INTO downloads (username, content_id, content_name, file_path, file_size, duration,
        width, height, has_audio, downloaded_at, thumbnail, search_order, rank)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(username, content_id) DO UPDATE SET
         file_path=excluded.file_path, file_size=excluded.file_size, downloaded_at=excluded.downloaded_at`,
      [
        r.username, r.contentId, r.contentName, r.filePath, r.fileSize, r.duration, r.width,
        r.height, r.hasAudio ? 1 : 0, r.downloadedAt, r.thumbnail, r.searchOrder, r.rank
      ]
    )
  }

  async getHistory(limit = 200): Promise<DownloadRecord[]> {
    const db = await this.open()
    const res = await db.query(
      'SELECT * FROM downloads ORDER BY downloaded_at DESC LIMIT ?',
      [limit]
    )
    return ((res.values ?? []) as Record<string, unknown>[]).map(rowToRecord)
  }

  async hasDownloaded(username: string, contentId: string): Promise<boolean> {
    const db = await this.open()
    const res = await db.query(
      'SELECT 1 FROM downloads WHERE username = ? AND content_id = ? LIMIT 1',
      [username, contentId]
    )
    return (res.values?.length ?? 0) > 0
  }
}

export const storage = new MobileStorage()
