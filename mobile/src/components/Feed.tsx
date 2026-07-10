import { useMemo, useState } from 'react'
import type { Content } from '@redloader/core'
import type { PagedFeed } from '../hooks/usePagedFeed'
import { usePlayer } from '../player/PlayerProvider'
import { sortContents, type SortKey } from '../lib/sort'
import SortMenu from './SortMenu'
import MediaGrid from './MediaGrid'

interface FeedProps {
  feed: PagedFeed
  label: string
  emptyMessage?: string
  emptyHint?: string
  /** Controlled sort — pass with onSortChange to place the SortMenu yourself. */
  sort?: SortKey
  onSortChange?: (key: SortKey) => void
  /** Suppress the built-in sort toolbar (when the screen renders SortMenu itself). */
  hideToolbar?: boolean
}

/**
 * The shared feed body: a sort control + the grid + the swipe player, wired to
 * one paginator. Sort is client-side and carried into the player. By default
 * Feed owns the sort state and renders its own toolbar; a screen can instead
 * drive it (sort/onSortChange) and render the SortMenu elsewhere with
 * hideToolbar, e.g. inline on the header row.
 */
export default function Feed({
  feed,
  label,
  emptyMessage = 'Nothing here',
  emptyHint,
  sort: sortProp,
  onSortChange,
  hideToolbar
}: FeedProps): React.JSX.Element {
  const player = usePlayer()
  const [innerSort, setInnerSort] = useState<SortKey>('default')
  const sort = sortProp ?? innerSort
  const setSort = onSortChange ?? setInnerSort
  const items = useMemo(() => sortContents(feed.items, sort), [feed.items, sort])

  const open = (_c: Content, index: number): void => {
    player.open({ items, index, label, loadMore: feed.loadMoreItems })
  }

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

  return (
    <>
      {!hideToolbar && (
        <div className="feed-toolbar">
          <SortMenu value={sort} onChange={setSort} />
        </div>
      )}
      <MediaGrid
        items={items}
        onOpen={open}
        onEndReached={feed.loadMore}
        hasMore={feed.hasMore}
        loading={feed.loading}
      />
    </>
  )
}
