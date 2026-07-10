import type { Content } from '@redloader/core'

export type SortKey = 'default' | 'recent' | 'likes' | 'views' | 'duration' | 'az'

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'default', label: 'Default' },
  { key: 'recent', label: 'Newest' },
  { key: 'likes', label: 'Most liked' },
  { key: 'views', label: 'Most viewed' },
  { key: 'duration', label: 'Longest' },
  { key: 'az', label: 'Creator' }
]

/**
 * Client-side sort applied to the loaded feed items — works on every feed,
 * including ones whose API has no order param (likes, collections, the offline
 * index). `default` keeps the server/insertion order.
 */
export function sortContents(items: Content[], key: SortKey): Content[] {
  if (key === 'default') return items
  const c = [...items]
  switch (key) {
    case 'recent':
      return c.sort((a, b) => b.createDate - a.createDate)
    case 'likes':
      return c.sort((a, b) => b.likes - a.likes)
    case 'views':
      return c.sort((a, b) => b.views - a.views)
    case 'duration':
      return c.sort((a, b) => (b.duration || 0) - (a.duration || 0))
    case 'az':
      return c.sort((a, b) => a.username.localeCompare(b.username))
    default:
      return c
  }
}
