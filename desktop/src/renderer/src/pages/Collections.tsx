import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import FeedState from '../components/FeedState'
import SignInGate from '../components/SignInGate'
import QualityToggle from '../components/QualityToggle'
import { IconDownload } from '../components/icons'
import { useNav } from '../context/nav'
import { useNotify } from '../context/notify'
import { useQuality } from '../context/quality'
import { useCachedResource } from '../hooks/useCachedResource'
import { useAuthed } from '../hooks/useAuthed'
import { formatCount } from '../lib/format'
import type { Collection } from '@shared/types'

/**
 * One collection card. The cover is the navigation target and "Save all" is a
 * real footer button — a card-wide <button> can't legally contain another
 * button, which is how the old absolutely-positioned overlay came to be.
 */
function CollectionCard({
  collection,
  onOpen
}: {
  collection: Collection
  onOpen: () => void
}): JSX.Element {
  const notify = useNotify()
  const { quality } = useQuality()
  // Per-card busy flag: queueing a whole collection isn't instant, and without
  // it a double-click enqueues the entire set twice.
  const [queuing, setQueuing] = useState(false)

  const saveAll = (): void => {
    if (queuing) return
    setQueuing(true)
    window.api
      .startDownload({ type: 'collection', collectionId: collection.id, quality })
      .then(() => notify('Queued ' + collection.name, 'success'))
      .catch((e) => notify('Download failed: ' + (e as Error).message, 'error'))
      .finally(() => setQueuing(false))
  }

  return (
    <div className="tile">
      <button className="tile-cover ar-3-4" onClick={onOpen} aria-label={'Open ' + collection.name}>
        {collection.thumbnailUrl && <img src={collection.thumbnailUrl} alt="" loading="lazy" />}
      </button>
      <div className="tile-title">{collection.name}</div>
      <div className="tile-sub">{formatCount(collection.contentCount)} items</div>
      <div className="tile-sub">
        <button className="btn btn-sm" onClick={saveAll} disabled={queuing}>
          <IconDownload />
          {queuing ? 'Queuing…' : 'Save all'}
        </button>
      </div>
    </div>
  )
}

/** Library → user's RedGifs collections as a responsive grid of cover cards. */
export default function Collections(): JSX.Element {
  const { navigate } = useNav()

  const authed = useAuthed()

  const { data, loading, error, refresh } = useCachedResource<Collection[]>(
    'collections',
    () => window.api.getCollections(),
    [authed]
  )
  const collections = data ?? []

  const header = (
    <PageHeader
      kicker="library"
      kickerIndex={5}
      title="Collections"
      right={
        <div className="controls">
          {collections.length > 0 && (
            <span className="readout">{formatCount(collections.length)} collections</span>
          )}
          <QualityToggle />
        </div>
      }
    />
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
        onRetry={refresh}
        skeletonCount={8}
      />
      {collections.length > 0 && (
        <div className="tile-grid">
          {collections.map((c) => (
            <CollectionCard
              key={c.id}
              collection={c}
              onOpen={() => navigate({ name: 'collection', id: c.id, title: c.name })}
            />
          ))}
        </div>
      )}
    </div>
  )
}
