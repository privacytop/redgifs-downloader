import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import Feed from '../components/Feed'
import ScreenHeader from '../components/ScreenHeader'

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
      <ScreenHeader title={`#${tag}`} back />
      <Feed feed={feed} label={`#${tag}`} emptyMessage={`Nothing tagged #${tag}`} />
    </div>
  )
}
