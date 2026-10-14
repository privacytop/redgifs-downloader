import { useLocation, useParams } from '../nav'
import { api } from '../lib/api'
import { usePagedFeed } from '../hooks/usePagedFeed'
import Feed from '../components/Feed'
import ScreenHeader from '../components/ScreenHeader'
import { CLIENT_SORTS } from '../lib/sort'
import { formatCount } from '../lib/format'

/**
 * One collection's gifs. The endpoint has no order param, so the sorts are
 * client-side — Feed drains every page first so they cover the whole folder.
 */
export default function CollectionDetail(): React.JSX.Element {
  const { id = '' } = useParams<{ id: string }>()
  const location = useLocation()
  const title = (location.state as { title?: string } | null)?.title ?? 'Collection'

  const feed = usePagedFeed((p) => api.getCollectionContent(id, p), [id], `feed:collection:${id}`)

  return (
    <div className="page">
      <ScreenHeader title={title} back />
      <Feed
        feed={feed}
        label={title}
        emptyMessage="Empty collection"
        sorts={CLIENT_SORTS}
        toolbarLeft={
          feed.total ? <span className="readout">{formatCount(feed.total)} gifs</span> : <span />
        }
      />
    </div>
  )
}
