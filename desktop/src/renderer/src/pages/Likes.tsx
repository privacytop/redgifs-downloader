import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import ViewToggle from '../components/ViewToggle'
import FeedGrid from '../components/FeedGrid'
import EmptyState from '../components/EmptyState'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useNotify } from '../context/notify'
import type { Content } from '@shared/types'

export default function Likes(): JSX.Element {
  const notify = useNotify()
  const [authed, setAuthed] = useState(false)
  const [checked, setChecked] = useState(false)
  const [mode, setMode] = useViewMode('likes', 'grid')

  useEffect(() => {
    window.api
      .authStatus()
      .then((s) => setAuthed(s.authenticated))
      .finally(() => setChecked(true))
  }, [])

  const feed = usePlayableFeed((p) => window.api.getLikes(p), 'Likes', [authed])

  const dl = (c: Content): void => {
    window.api
      .downloadContents([c], c.username)
      .then(() => notify('Saving @' + c.username, 'success'))
      .catch((e) => notify('Download failed: ' + e.message, 'error'))
  }

  if (checked && !authed) {
    return (
      <div className="page">
        <PageHeader kicker="library" kickerIndex={6} title="Likes" />
        <EmptyState
          message="Sign in to see this"
          hint="Your likes live in your RedGifs account. Sign in to bring them here."
          action={
            <button className="btn btn-ember" onClick={() => window.api.login()}>
              Sign in
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        kicker="library"
        kickerIndex={6}
        title="Likes"
        right={<ViewToggle value={mode} onChange={setMode} />}
      />
      {feed.error && <EmptyState message="Couldn't load" hint={feed.error} />}
      {!feed.error && feed.contents.length === 0 && !feed.loading && (
        <EmptyState message="Nothing here yet" hint="Gifs you like on RedGifs will show up here." />
      )}
      <FeedGrid items={feed.contents} mode={mode} onOpen={feed.openAt} onDownload={dl} />
      {feed.hasMore && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button className="btn" onClick={feed.loadMore} disabled={feed.loading}>
            {feed.loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
