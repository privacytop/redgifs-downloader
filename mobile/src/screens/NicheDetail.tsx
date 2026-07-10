import { useLocation, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import Feed from '../components/Feed'

/**
 * NicheDetail: gifs inside one niche. Title comes from navigation state (set by
 * the linking screen) and falls back to 'Niche'. Uses the shared sortable feed.
 */
export default function NicheDetail(): React.JSX.Element {
  const { id = '' } = useParams()
  const location = useLocation()
  const title = (location.state as { title?: string } | null)?.title ?? 'Niche'

  const feed = usePagedFeed((p) => api.getNicheGifs(id, 'best', p), [id], `feed:niche:${id}`)

  return (
    <div className="page">
      <h1 className="title">{title}</h1>
      <div style={{ height: 10 }} />
      <Feed feed={feed} label={title} emptyMessage="Nothing here yet" />
    </div>
  )
}
