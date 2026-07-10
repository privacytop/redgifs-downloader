import { useLocation, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import Feed from '../components/Feed'

/** One collection's gifs, with the shared sortable feed. */
export default function CollectionDetail(): React.JSX.Element {
  const { id = '' } = useParams()
  const location = useLocation()
  const title = (location.state as { title?: string } | null)?.title ?? 'Collection'

  const feed = usePagedFeed((p) => api.getCollectionContent(id, p), [id], `feed:collection:${id}`)

  return (
    <div className="page">
      <h1 className="title">{title}</h1>
      <hr className="rule" />
      <Feed feed={feed} label={title} emptyMessage="Empty collection" />
    </div>
  )
}
