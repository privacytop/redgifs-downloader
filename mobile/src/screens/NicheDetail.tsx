import { useState } from 'react'
import { useLocation, useParams } from '../nav'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import Feed from '../components/Feed'
import ScreenHeader from '../components/ScreenHeader'
import { NICHE_SORTS, findSort } from '../lib/sort'
import { formatCount } from '../lib/format'

/**
 * NicheDetail: gifs inside one niche, server-sorted (hot / trending / newest /
 * oldest / best — the orders /niches/{id}/gifs accepts). Title comes from
 * navigation state (set by the linking screen) and falls back to 'Niche'.
 */
export default function NicheDetail(): React.JSX.Element {
  const { id = '' } = useParams<{ id: string }>()
  const location = useLocation()
  const title = (location.state as { title?: string } | null)?.title ?? 'Niche'
  const [sort, setSort] = useState('hot')
  const order = findSort(NICHE_SORTS, sort).order ?? 'hot'

  const feed = usePagedFeed((p) => api.getNicheGifs(id, order, p), [id, order], `feed:niche:${order}:${id}`)

  return (
    <div className="page">
      <ScreenHeader title={title} back />
      <Feed
        feed={feed}
        label={title}
        emptyMessage="Nothing here yet"
        sorts={NICHE_SORTS}
        sort={sort}
        onSortChange={setSort}
        toolbarLeft={
          feed.total ? <span className="readout">{formatCount(feed.total)} gifs</span> : <span />
        }
      />
    </div>
  )
}
