/**
 * Pure SQL composition for the offline-index query (no sqlite dependency, so
 * it is unit-testable). `storage.queryLibrary` feeds the result to sqlite.
 */

/** Offline-index sort keys (SQL ORDER BY, so they cover the WHOLE index). */
export type LibrarySort = 'newest' | 'oldest' | 'views' | 'likes' | 'duration' | 'az'

/**
 * A structured query over the offline index. Everything is applied in SQL:
 * "videos with tags A and B, inside collection X or Y, with ≥ N views, sorted
 * by most viewed" is one indexed statement, paged with LIMIT/OFFSET.
 */
export interface LibraryQuery {
  /** Free text: every whitespace-separated term must match title, creator or a tag. */
  text?: string
  /** Tags the gif must carry (`all` = AND, `any` = OR). Case-insensitive. */
  tags?: string[]
  tagMode?: 'all' | 'any'
  /** Collection ids — the gif must be in ANY of them. */
  collections?: string[]
  likedOnly?: boolean
  creator?: string
  minViews?: number
  minLikes?: number
  /** Seconds. */
  minDuration?: number
  /** Tags that hide a gif (the user's blocked tags). */
  excludeTags?: Iterable<string>
  sort?: LibrarySort
}

export const LIBRARY_ORDER_BY: Record<LibrarySort, string> = {
  newest: 'g.create_date DESC, g.rowid DESC',
  oldest: 'g.create_date ASC, g.rowid ASC',
  views: 'g.views DESC, g.create_date DESC',
  likes: 'g.likes DESC, g.create_date DESC',
  duration: 'g.duration DESC, g.create_date DESC',
  az: 'g.username COLLATE NOCASE ASC, g.create_date DESC'
}

export function likeEscape(term: string): string {
  return term.replace(/[\\%_]/g, (m) => '\\' + m)
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(',')
}

const TAG_LIKE = "EXISTS (SELECT 1 FROM gif_tags t WHERE t.gif_id = g.id AND t.tag LIKE ? ESCAPE '\\')"

/** WHERE clause (incl. the keyword, or '' when unfiltered) + bound params, for `gif_cache g`. */
export function buildLibraryWhere(q: LibraryQuery): { where: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  const terms = (q.text ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  for (const term of terms) {
    const like = `%${likeEscape(term)}%`
    clauses.push(`(g.title LIKE ? ESCAPE '\\' OR g.username LIKE ? ESCAPE '\\' OR ${TAG_LIKE})`)
    params.push(like, like, like)
  }

  const tags = Array.from(new Set((q.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean)))
  if (tags.length) {
    if ((q.tagMode ?? 'all') === 'any') {
      clauses.push(`EXISTS (SELECT 1 FROM gif_tags t WHERE t.gif_id = g.id AND t.tag IN (${placeholders(tags.length)}))`)
      params.push(...tags)
    } else {
      for (const t of tags) {
        clauses.push('EXISTS (SELECT 1 FROM gif_tags t WHERE t.gif_id = g.id AND t.tag = ?)')
        params.push(t)
      }
    }
  }

  const cols = (q.collections ?? []).filter(Boolean)
  if (cols.length) {
    clauses.push(
      `EXISTS (SELECT 1 FROM gif_membership m WHERE m.gif_id = g.id AND m.source_type = 'collection' AND m.source_id IN (${placeholders(cols.length)}))`
    )
    params.push(...cols)
  }
  if (q.likedOnly) {
    clauses.push("EXISTS (SELECT 1 FROM gif_membership m WHERE m.gif_id = g.id AND m.source_type = 'liked')")
  }
  if (q.creator?.trim()) {
    clauses.push('g.username = ? COLLATE NOCASE')
    params.push(q.creator.trim())
  }
  if (q.minViews && q.minViews > 0) {
    clauses.push('g.views >= ?')
    params.push(q.minViews)
  }
  if (q.minLikes && q.minLikes > 0) {
    clauses.push('g.likes >= ?')
    params.push(q.minLikes)
  }
  if (q.minDuration && q.minDuration > 0) {
    clauses.push('g.duration >= ?')
    params.push(q.minDuration)
  }
  const excluded = Array.from(new Set(Array.from(q.excludeTags ?? []).map((t) => t.toLowerCase())))
  if (excluded.length) {
    clauses.push(`NOT EXISTS (SELECT 1 FROM gif_tags t WHERE t.gif_id = g.id AND t.tag IN (${placeholders(excluded.length)}))`)
    params.push(...excluded)
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}
