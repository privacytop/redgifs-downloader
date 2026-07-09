import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import FeedState from '../components/FeedState'
import SignInGate from '../components/SignInGate'
import { IconBookmark, IconDownload } from '../components/icons'
import { useNav } from '../context/nav'
import { useNotify } from '../context/notify'
import { useQuality } from '../context/quality'
import { useCachedResource } from '../hooks/useCachedResource'
import { useAuthed } from '../hooks/useAuthed'
import { formatCount } from '../lib/format'
import type { Collection } from '@shared/types'

/**
 * One collection card: a 16:9 cover with an invisible full-cover "open"
 * button (`.card-open` lives inside `.tile-cover`, which is the positioning
 * context), a plain title/meta block, and a real "Save all" footer button.
 * Keeping open + save as sibling buttons avoids the nested-button ARIA trap.
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
  const [queued, setQueued] = useState(false)
  // Covers come from RedGifs CDN URLs that expire — a broken <img> must fall
  // back to the initial-letter monogram. Track WHICH url failed so a refetch
  // that returns a fresh working url gets rendered again.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)

  const initial = (collection.name.trim().charAt(0) || '#').toUpperCase()
  const hasCover = Boolean(collection.thumbnailUrl) && brokenUrl !== collection.thumbnailUrl

  const saveAll = (): void => {
    if (queuing || queued) return
    setQueuing(true)
    window.api
      .startDownload({ type: 'collection', collectionId: collection.id, quality })
      .then(() => {
        setQueued(true)
        notify('Queued ' + collection.name, 'success')
      })
      .catch((e) => notify('Download failed: ' + (e as Error).message, 'error'))
      .finally(() => setQueuing(false))
  }

  return (
    <div className="tile">
      <div className="tile-cover ar-16-9">
        {hasCover ? (
          <img
            src={collection.thumbnailUrl}
            alt=""
            loading="lazy"
            onError={() => setBrokenUrl(collection.thumbnailUrl)}
          />
        ) : (
          <div className="player-empty" aria-hidden="true">
            <span className="hero-avatar">{initial}</span>
          </div>
        )}
        <button className="card-open" onClick={onOpen} aria-label={'Open ' + collection.name} />
      </div>
      <div className="tile-title">{collection.name}</div>
      <div className="tile-sub">
        {formatCount(collection.contentCount)} gifs
        {!collection.published && ' · private'}
      </div>
      <div className="tile-sub">
        <button className="btn btn-sm" onClick={saveAll} disabled={queuing || queued}>
          <IconDownload />
          {queuing ? 'Queuing…' : queued ? 'Queued' : 'Save all'}
        </button>
      </div>
    </div>
  )
}

/**
 * Trailing "New collection" tile. Idle it reads as an invitation (icon + mono
 * label); clicked it flips to an inline name field with Create/Cancel. Enter
 * creates, Escape cancels, and everything locks while the request is in
 * flight.
 */
function NewCollectionTile({ onCreated }: { onCreated: () => void }): JSX.Element {
  const notify = useNotify()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  const cancel = (): void => {
    if (creating) return
    setEditing(false)
    setName('')
  }

  const create = (): void => {
    const trimmed = name.trim()
    if (trimmed === '' || creating) return
    setCreating(true)
    window.api
      .createCollection(trimmed)
      .then(() => {
        notify('Created ' + trimmed, 'success')
        setName('')
        setEditing(false)
        onCreated()
      })
      .catch((e) => notify('Create failed: ' + (e as Error).message, 'error'))
      .finally(() => setCreating(false))
  }

  if (!editing) {
    return (
      <button type="button" className="tile" onClick={() => setEditing(true)}>
        <div className="empty">
          <div className="empty-icon">
            <IconBookmark />
          </div>
          <div className="empty-msg">New collection</div>
        </div>
      </button>
    )
  }

  return (
    <div className="tile">
      <div className="field">
        <label className="field-label" htmlFor="new-collection-name">
          New collection
        </label>
        <input
          id="new-collection-name"
          value={name}
          placeholder="Name"
          disabled={creating}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create()
            if (e.key === 'Escape') cancel()
          }}
        />
        <div className="field-hint">Enter to create · Esc to cancel</div>
      </div>
      <div className="controls">
        <button className="btn btn-sm btn-ghost" onClick={cancel} disabled={creating}>
          Cancel
        </button>
        <button
          className="btn btn-sm btn-ember"
          onClick={create}
          disabled={creating || name.trim() === ''}
        >
          {creating ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  )
}

/**
 * Library → the user's RedGifs collections as a cover-art gallery: 16:9 cover
 * cards on the shared tile grid, plus a trailing create tile. The create tile
 * doubles as the empty state, so a fresh account still has one obvious action.
 */
export default function Collections(): JSX.Element {
  const { navigate } = useNav()

  const authed = useAuthed()

  const { data, loading, error, refresh } = useCachedResource<Collection[]>(
    'collections',
    () => window.api.getCollections(),
    [authed]
  )
  const collections = data ?? []
  const empty = collections.length === 0

  const header = (
    <PageHeader
      kicker="library"
      kickerIndex={5}
      title="Collections"
      right={
        empty ? undefined : (
          <span className="readout">{formatCount(collections.length)} collections</span>
        )
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
      {error && empty ? (
        <FeedState loading={loading} error={error} isEmpty onRetry={refresh} skeleton="none" />
      ) : loading && empty ? (
        <div className="skel-grid wide" aria-busy="true" aria-label="Loading collections">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skel skel-tile-wide" />
          ))}
        </div>
      ) : (
        <>
          <div className="tile-grid">
            {collections.map((c) => (
              <CollectionCard
                key={c.id}
                collection={c}
                onOpen={() => navigate({ name: 'collection', id: c.id, title: c.name })}
              />
            ))}
            <NewCollectionTile onCreated={refresh} />
          </div>
          {/* A refresh failure over a warm cache must not read as "up to date". */}
          {error && !empty && (
            <div className="feed-error" role="alert">
              <span>Couldn’t refresh — {error}</span>
              <button type="button" className="btn btn-sm" onClick={refresh} disabled={loading}>
                Try again
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
