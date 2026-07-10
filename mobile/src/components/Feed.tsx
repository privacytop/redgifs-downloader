import { useMemo, useState } from 'react'
import type { Content } from '@redloader/core'
import type { PagedFeed } from '../hooks/usePagedFeed'
import { usePlayer } from '../player/PlayerProvider'
import { sortContents, type SortKey } from '../lib/sort'
import SortBar from './SortBar'
import MediaGrid from './MediaGrid'

interface FeedProps {
  feed: PagedFeed
  label: string
  emptyMessage?: string
  emptyHint?: string
}

/**
 * The shared feed body: a sort bar + the grid + the swipe player, wired to one
 * paginator. The client-side sort reorders the loaded items instantly and is
 * carried into the player, so every screen that renders a feed gets the same
 * sorting for free.
 */
export default function Feed({ feed, label, emptyMessage = 'Nothing here', emptyHint }: FeedProps): React.JSX.Element {
  const player = usePlayer()
  const [sort, setSort] = useState<SortKey>('default')
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
      <SortBar value={sort} onChange={setSort} />
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
