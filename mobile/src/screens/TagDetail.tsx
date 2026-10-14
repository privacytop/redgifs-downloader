import { useState } from 'react'
import { useParams } from '../nav'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import Feed from '../components/Feed'
import ScreenHeader from '../components/ScreenHeader'
import { SEARCH_SORTS, findSort } from '../lib/sort'
import { formatCount } from '../lib/format'

/** TagDetail: every gif under a single #tag, server-sorted (/gifs/search). */
export default function TagDetail(): React.JSX.Element {
  const { tag = '' } = useParams<{ tag: string }>()
  const [sort, setSort] = useState('trending')
  const order = findSort(SEARCH_SORTS, sort).order ?? 'trending'

  const feed = usePagedFeed(
    (p) => api.searchGifs({ tags: tag, order, page: p }),
    [tag, order],
    `feed:tag:${order}:${tag}`
  )

  return (
    <div className="page">
      <ScreenHeader title={`#${tag}`} back />
      <Feed
        feed={feed}
        label={`#${tag}`}
        emptyMessage={`Nothing tagged #${tag}`}
        sorts={SEARCH_SORTS}
        sort={sort}
        onSortChange={setSort}
        toolbarLeft={
          feed.total ? <span className="readout">{formatCount(feed.total)} gifs</span> : <span />
        }
      />
    </div>
  )
}
