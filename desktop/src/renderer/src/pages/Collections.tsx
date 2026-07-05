import { useCallback } from 'react'
import PageHeader from '../components/PageHeader'
import FeedState from '../components/FeedState'
import SignInGate from '../components/SignInGate'
import { useNav } from '../context/nav'
import { useNotify } from '../context/notify'
import { useCachedResource } from '../hooks/useCachedResource'
import { useAuthed } from '../hooks/useAuthed'
import { formatCount } from '../lib/format'
import type { Collection } from '@shared/types'

/** Library → user's RedGifs collections as a responsive grid of cover cards. */
export default function Collections(): JSX.Element {
  const { navigate } = useNav()
  const notify = useNotify()

  const authed = useAuthed()

  const {
    data,
    loading,
    error
  } = useCachedResource<Collection[]>('collections', () => window.api.getCollections(), [authed])
  const collections = data ?? []

  const downloadAll = useCallback(
    (c: Collection, e: React.MouseEvent) => {
      e.stopPropagation()
      window.api
        .startDownload({ type: 'collection', collectionId: c.id })
        .then(() => notify('Queued ' + c.name, 'success'))
        .catch((err: Error) => notify('Download failed: ' + err.message, 'error'))
    },
    [notify]
  )

  const readout =
    collections.length > 0 ? (
      <span className="readout">{formatCount(collections.length)} collections</span>
    ) : undefined

  const header = (
    <PageHeader kicker="library" kickerIndex={5} title="Collections" right={readout} />
  )

  if (authed === false) {
    return (
      <div className="page">
        {header}
        <SignInGate hint="Your collections live in your RedGifs library." />
      </div>
    )
  }

  return (
    <div className="page">
      {header}
      <FeedState
        loading={loading}
        error={error}
        isEmpty={collections.length === 0}
        emptyMessage="No collections yet"
        emptyHint="Collections you create on RedGifs will appear here."
        skeletonCount={8}
      />
      {collections.length > 0 && (
        <div className="tile-grid">
          {collections.map((c) => (
            <div key={c.id} style={{ position: 'relative' }}>
              <button
                className="tile"
                onClick={() => navigate({ name: 'collection', id: c.id, title: c.name })}
              >
                <div className="tile-cover ar-3-4">
                  {c.thumbnailUrl && (
                    <img src={c.thumbnailUrl} alt={c.name} loading="lazy" />
                  )}
                </div>
                <div className="tile-title">{c.name}</div>
                <div className="tile-sub">{formatCount(c.contentCount)} items</div>
              </button>
              <button
                className="pcard-dl"
                onClick={(e) => downloadAll(c, e)}
                title={'Download all of ' + c.name}
                aria-label={'Download all of ' + c.name}
                style={{ opacity: 1, transform: 'none' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
