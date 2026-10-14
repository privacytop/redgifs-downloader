import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Content } from '@redloader/core'
import type { PagedFeed } from '../hooks/usePagedFeed'
import { usePlayer } from '../player/PlayerProvider'
import { CLIENT_SORTS, findSort, sortContents, type SortOption } from '../lib/sort'
import SortMenu from './SortMenu'
import MediaGrid from './MediaGrid'
import { formatCount } from '../lib/format'

interface FeedProps {
  feed: PagedFeed
  label: string
  emptyMessage?: string
  emptyHint?: string
  /**
   * The sort options this feed supports (server orders for API-sortable feeds,
   * CLIENT_SORTS otherwise). Server orders are applied by the SCREEN (it puts
   * the order into the fetcher + deps); Feed only renders the menu for them.
   * Client sorts are applied here, after draining every page.
   */
  sorts?: SortOption[]
  sort?: string
  onSortChange?: (key: string) => void
  /** Suppress the built-in toolbar (when the screen places the SortMenu itself). */
  hideToolbar?: boolean
  /** Optional content on the left of the built-in toolbar. */
  toolbarLeft?: ReactNode
}

/**
 * The shared feed body: sort control + grid + swipe player, wired to one
 * paginator. With a client sort active it drains the whole feed first so the
 * order is global, and shows progress while it does.
 */
export default function Feed({
  feed,
  label,
  emptyMessage = 'Nothing here',
  emptyHint,
  sorts = CLIENT_SORTS,
  sort: sortProp,
  onSortChange,
  hideToolbar,
  toolbarLeft
}: FeedProps): React.JSX.Element {
  const player = usePlayer()
  const [innerSort, setInnerSort] = useState<string>(sorts[0]?.key ?? 'default')
  const sortKey = sortProp ?? innerSort
  const setSort = onSortChange ?? setInnerSort
  const active = findSort(sorts, sortKey)
  const clientSort = active.client

  const items = useMemo(() => sortContents(feed.items, clientSort), [feed.items, clientSort])
  const itemsRef = useRef(items)
  itemsRef.current = items

  // A client sort is only honest when it covers every page: drain on demand.
  const { drain, hasMore, draining } = feed
  useEffect(() => {
    if (clientSort && hasMore && !draining) void drain()
  }, [clientSort, hasMore, draining, drain])

  const open = useCallback(
    (_c: Content, index: number): void => {
      player.open({ items: itemsRef.current, index, label, loadMore: feed.loadMoreItems })
    },
    [player, label, feed.loadMoreItems]
  )

  if (feed.error && feed.items.length === 0) {
    return (
      <div className="empty">
        <div className="empty-msg">Couldn’t load</div>
        <div className="empty-sub">{feed.error}</div>
        <button className="btn" onClick={feed.reload}>Try again</button>
      </div>
    )
  }
  if (!feed.loading && feed.items.length === 0) {
    return (
      <div className="empty">
        <div className="empty-msg">{emptyMessage}</div>
        {emptyHint && <div className="empty-sub">{emptyHint}</div>}
      </div>
    )
  }

  const drainNote =
    clientSort && (draining || hasMore) ? (
      <div className="feed-note" role="status">
        Sorting everything · page {feed.page}/{Math.min(feed.pages, 40)}
        {feed.total ? ` · ${formatCount(feed.total)} items` : ''}
      </div>
    ) : null

  return (
    <>
      {!hideToolbar && (
        <div className={`feed-toolbar ${toolbarLeft ? 'with-left' : ''}`}>
          {toolbarLeft}
          <SortMenu options={sorts} value={active.key} onChange={setSort} />
        </div>
      )}
      {drainNote}
      <MediaGrid
        items={items}
        onOpen={open}
        onEndReached={feed.loadMore}
        hasMore={feed.hasMore}
        loading={feed.loading && !draining}
      />
      {draining && <div className="loading">Loading all pages…</div>}
    </>
  )
}
