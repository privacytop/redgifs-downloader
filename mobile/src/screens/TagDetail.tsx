import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import Feed from '../components/Feed'

/** TagDetail: every gif under a single #tag, with the shared sortable feed. */
export default function TagDetail(): React.JSX.Element {
  const { tag: raw } = useParams<{ tag: string }>()
  const tag = decodeURIComponent(raw ?? '')

  const feed = usePagedFeed(
    (p) => api.searchGifs({ tags: tag, order: 'latest', page: p }),
    [tag],
    `feed:tag:${tag}`
  )

  return (
    <div className="page">
      <h1 className="title">#{tag}</h1>
      <div style={{ height: 10 }} />
      <Feed feed={feed} label={`#${tag}`} emptyMessage={`Nothing tagged #${tag}`} />
    </div>
  )
}
