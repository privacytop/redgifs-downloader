import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import {
  SCHEMA,
  filterCachedRows,
  rowToRecord,
  type Content,
  type DownloadRecord
} from '@redloader/core'

export type CacheSource = { type: 'collection' | 'liked'; id: string }
export interface CacheFilter {
  tags?: string[]
  sources?: CacheSource[]
  likedOnly?: boolean
}

const DB_NAME = 'redloader'

/**
 * Async sqlite storage for the mobile app — the metadata index (gif cache +
 * membership) plus download history and tokens. Uses the same schema and pure
 * row transforms as desktop (@redloader/core), so the two stay identical.
 * @capacitor-community/sqlite is async, hence every method returns a Promise.
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
      this.db = db
      return db
    })()
    this.opening.catch(() => {
      this.opening = null
    })
    return this.opening
  }

  async cacheContents(contents: Content[], source: CacheSource): Promise<void> {
    if (!contents.length) return
    const db = await this.open()
    const now = Date.now()
    const statements = contents.flatMap((c) => [
      {
        statement:
          'INSERT OR REPLACE INTO gif_cache (id, username, data, tags, cached_at) VALUES (?,?,?,?,?)',
        values: [c.id, c.username ?? '', JSON.stringify(c), JSON.stringify(c.tags ?? []), now]
      },
      {
        statement:
          'INSERT OR IGNORE INTO gif_membership (gif_id, source_type, source_id) VALUES (?,?,?)',
        values: [c.id, source.type, source.id]
      }
    ])
    await db.executeSet(statements)
  }

  async searchCachedGifs(filter: CacheFilter): Promise<Content[]> {
    const db = await this.open()
    const clauses: string[] = []
    const params: unknown[] = []
    for (const src of filter.sources ?? []) {
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
    const res = await db.query(`SELECT data FROM gif_cache ${where}`, params as never[])
    return filterCachedRows((res.values ?? []) as { data: string }[], filter.tags)
  }

  async cachedCount(): Promise<number> {
    const db = await this.open()
    const res = await db.query('SELECT COUNT(*) n FROM gif_cache')
    return Number((res.values?.[0] as { n?: number })?.n ?? 0)
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
