import { useCallback } from 'react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
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

  const header = <PageHeader kicker="library" kickerIndex={5} title="Collections" />

  if (authed === false) {
    return (
      <div className="page">
        {header}
        <EmptyState
          message="Sign in to see this"
          hint="Your collections live in your RedGifs library."
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
      {header}
      {error && <EmptyState message="Couldn't load collections" hint={error} />}
      {!error && !loading && collections.length === 0 && (
        <EmptyState
          message="No collections yet"
          hint="Collections you create on RedGifs will appear here."
        />
      )}
      {!error && collections.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 18
          }}
        >
          {collections.map((c) => (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate({ name: 'collection', id: c.id, title: c.name })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate({ name: 'collection', id: c.id, title: c.name })
                }
              }}
              style={{
                cursor: 'pointer',
                background: 'var(--panel)',
                border: '1px solid var(--line)',
                borderRadius: 10,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <div
                style={{
                  position: 'relative',
                  aspectRatio: '3 / 4',
                  minHeight: 220,
                  background: 'var(--bg)',
                  overflow: 'hidden'
                }}
              >
                {c.thumbnailUrl ? (
                  <img
                    src={c.thumbnailUrl}
                    alt={c.name}
                    loading="lazy"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block'
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--dim)',
                      fontFamily: '"Space Mono", monospace',
                      fontSize: 12,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase'
                    }}
                  >
                    No cover
                  </div>
                )}
                <button
                  className="btn btn-ember btn-sm"
                  onClick={(e) => downloadAll(c, e)}
                  title={'Download all of ' + c.name}
                  style={{ position: 'absolute', top: 10, right: 10 }}
                >
                  Download all
                </button>
              </div>
              <div
                style={{
                  padding: '12px 14px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6
                }}
              >
                <div
                  style={{
                    fontFamily: '"Fraunces", serif',
                    fontSize: 18,
                    lineHeight: 1.2,
                    color: 'var(--cream)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {c.name}
                </div>
                <div
                  style={{
                    fontFamily: '"Space Mono", monospace',
                    fontSize: 12,
                    letterSpacing: '0.04em',
                    color: 'var(--mut)'
                  }}
                >
                  {formatCount(c.contentCount)} items
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
