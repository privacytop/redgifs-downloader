/**
 * Single source of truth for feed sort orders and content types.
 *
 * Before this file every feed page declared its own local `ORDERS` array with
 * different members (Creator had `oldest`, NicheDetail had an invalid `hot`,
 * Search froze `score`), so no two sort controls offered the same options.
 *
 * The set below is the intersection that works across the RedGifs list
 * endpoints the app actually calls (`gifs/search`, user/creator, niche,
 * collection, likes). Note `order=trending` is intentionally excluded: on
 * `gifs/search` it returns an empty cursor-based page, so exposing it would look
 * broken on most feeds.
 */

export type Order = 'latest' | 'best' | 'top' | 'new' | 'score'

export const ORDERS: { id: Order; label: string }[] = [
  { id: 'latest', label: 'Latest' },
  { id: 'best', label: 'Best' },
  { id: 'top', label: 'Top' },
  { id: 'new', label: 'New' }
]

export const DEFAULT_ORDER: Order = 'latest'

/**
 * Search-only order list: `score` (relevance) is valid solely on the text
 * search endpoint — every other feed keeps the shared `ORDERS` set. Search
 * defaults to relevance, matching redgifs.com.
 */
export const SEARCH_ORDERS: { id: Order; label: string }[] = [
  { id: 'score', label: 'Relevance' },
  ...ORDERS
]

/** RedGifs content-type param: `g` = videos, `i` = images. */
export type ContentType = 'g' | 'i'

export const CONTENT_TYPES: { id: ContentType; label: string }[] = [
  { id: 'g', label: 'Videos' },
  { id: 'i', label: 'Images' }
]

/** Human noun for a content type, used in kickers and empty-state hints. */
export function typeNoun(type: ContentType, plural = true): string {
  const base = type === 'g' ? 'video' : 'image'
  return plural ? `${base}s` : base
}
