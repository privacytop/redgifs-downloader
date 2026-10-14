import type { Content } from '@redloader/core'

/**
 * Sorting comes in two flavours and the UI must never confuse them:
 *
 * - `order` — a SERVER sort. The API re-ranks the WHOLE result set and we page
 *   through it. Each endpoint accepts a different set (probed live, see
 *   `redgifs-order-matrix` in memory); the per-feed option lists below only
 *   contain values that endpoint really accepts.
 * - `client` — a LOCAL sort for feeds whose endpoint has no order param (For
 *   you, Likes, collections). To make it global rather than "whatever happened
 *   to be loaded", the Feed drains every remaining page first (capped).
 */
export type ServerOrder = 'trending' | 'latest' | 'oldest' | 'top' | 'top7' | 'top28' | 'score' | 'best' | 'hot'
export type ClientSort = 'recent' | 'likes' | 'views' | 'duration' | 'az'

export interface SortOption {
  key: string
  label: string
  order?: ServerOrder
  client?: ClientSort
}

/** `/gifs/search`: Trending, #tag, Discover "fresh". */
export const SEARCH_SORTS: SortOption[] = [
  { key: 'trending', label: 'Trending', order: 'trending' },
  { key: 'latest', label: 'Newest', order: 'latest' },
  { key: 'top7', label: 'Top this week', order: 'top7' },
  { key: 'top28', label: 'Top this month', order: 'top28' },
  { key: 'top', label: 'Top all time', order: 'top' }
]

/** Text search adds relevance (`score`), the site's default. */
export const TEXT_SEARCH_SORTS: SortOption[] = [
  { key: 'score', label: 'Relevance', order: 'score' },
  ...SEARCH_SORTS
]

/** `/users/{u}/search` (creator pages). */
export const CREATOR_SORTS: SortOption[] = [
  { key: 'latest', label: 'Newest', order: 'latest' },
  { key: 'oldest', label: 'Oldest', order: 'oldest' },
  { key: 'trending', label: 'Trending', order: 'trending' },
  { key: 'top7', label: 'Top this week', order: 'top7' },
  { key: 'top28', label: 'Top this month', order: 'top28' },
  { key: 'top', label: 'Top all time', order: 'top' }
]

/** `/niches/{id}/gifs`. */
export const NICHE_SORTS: SortOption[] = [
  { key: 'hot', label: 'Hot', order: 'hot' },
  { key: 'trending', label: 'Trending', order: 'trending' },
  { key: 'latest', label: 'Newest', order: 'latest' },
  { key: 'oldest', label: 'Oldest', order: 'oldest' },
  { key: 'best', label: 'Best', order: 'best' }
]

/** Feeds with no server order (For you, Likes, collections, offline index). */
export const CLIENT_SORTS: SortOption[] = [
  { key: 'default', label: 'Default' },
  { key: 'recent', label: 'Newest', client: 'recent' },
  { key: 'likes', label: 'Most liked', client: 'likes' },
  { key: 'views', label: 'Most viewed', client: 'views' },
  { key: 'duration', label: 'Longest', client: 'duration' },
  { key: 'az', label: 'Creator A–Z', client: 'az' }
]

/** Offline index: SQL ORDER BY over the whole library (see storage.queryLibrary). */
export const LIBRARY_SORTS: SortOption[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'views', label: 'Most viewed' },
  { key: 'likes', label: 'Most liked' },
  { key: 'duration', label: 'Longest' },
  { key: 'az', label: 'Creator A–Z' }
]

/** The option for `key`, else the first option (the feed's default). */
export function findSort(options: SortOption[], key: string | undefined): SortOption {
  return options.find((o) => o.key === key) ?? options[0]
}

const comparators: Record<ClientSort, (a: Content, b: Content) => number> = {
  recent: (a, b) => b.createDate - a.createDate,
  likes: (a, b) => b.likes - a.likes,
  views: (a, b) => b.views - a.views,
  duration: (a, b) => (b.duration || 0) - (a.duration || 0),
  az: (a, b) => a.username.localeCompare(b.username)
}

/** Stable client-side sort; `undefined` keeps the server/insertion order. */
export function sortContents(items: Content[], key: ClientSort | undefined): Content[] {
  if (!key) return items
  return [...items].sort(comparators[key])
}
