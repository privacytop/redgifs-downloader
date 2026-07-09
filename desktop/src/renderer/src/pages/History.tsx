import { useState } from 'react'
import type { DownloadRecord, Statistics } from '@shared/types'
import PageHeader from '../components/PageHeader'
import FeedState from '../components/FeedState'
import { useNav } from '../context/nav'
import { useNotify } from '../context/notify'
import { useCachedResource } from '../hooks/useCachedResource'
import { formatSize, formatCount } from '../lib/format'

/** getHistory is capped at this many rows; a full page means "there's more". */
const HISTORY_LIMIT = 200

interface Tile {
  label: string
  value: string
}

function StatTile({ label, value }: Tile): JSX.Element {
  return (
    <div className="stat-tile stat">
      <div className="stat-n">{value}</div>
      <div className="stat-l">{label}</div>
    </div>
  )
}

export default function History(): JSX.Element {
  const { navigate } = useNav()
  const notify = useNotify()
  const {
    data: recordsData,
    loading: recordsLoading,
    error: recordsError,
    refresh: refreshRecords
  } = useCachedResource<DownloadRecord[]>(
    'history',
    () => window.api.getHistory(undefined, HISTORY_LIMIT),
    []
  )
  const {
    data: stats,
    loading: statsLoading,
    error: statsError,
    refresh: refreshStats
  } = useCachedResource<Statistics>('stats', () => window.api.getStats(), [])

  // Only one file opens at a time; the row's button disables while in flight.
  const [openingId, setOpeningId] = useState<number | null>(null)

  const records = recordsData ?? []
  const loading = recordsLoading && recordsData === null

  const openFile = (r: DownloadRecord): void => {
    setOpeningId(r.id)
    window.api
      .openPath(r.filePath)
      .catch((e: unknown) =>
        notify(`Couldn’t open file: ${e instanceof Error ? e.message : String(e)}`, 'error')
      )
      .finally(() => setOpeningId((id) => (id === r.id ? null : id)))
  }

  const topUser = stats?.topUsers?.[0]

  const tiles: Tile[] = [
    { label: 'Total downloads', value: stats ? formatCount(stats.totalDownloads) : '—' },
    { label: 'Total size', value: stats ? formatSize(stats.totalSize) : '—' },
    { label: 'Users', value: stats ? formatCount(stats.totalUsers) : '—' }
  ]
  if (topUser) {
    tiles.push({ label: 'Top user', value: '@' + topUser.username })
  }

  return (
    <div className="page">
      <PageHeader kicker="library" kickerIndex={8} title="History" />

      <div className="statset" style={{ marginBottom: 28 }}>
        {tiles.map((t) => (
          <StatTile key={t.label} label={t.label} value={t.value} />
        ))}
        {/* A failed stats fetch would otherwise leave "—" tiles forever. */}
        {statsError && (
          <div className="stat">
            <button className="btn btn-sm" disabled={statsLoading} onClick={refreshStats}>
              {statsLoading ? 'Retrying…' : 'Retry stats'}
            </button>
          </div>
        )}
      </div>

      <FeedState
        loading={loading}
        error={recordsError}
        isEmpty={records.length === 0}
        emptyMessage="No downloads yet"
        emptyHint="Saved content will be logged here with its details."
        onRetry={refreshRecords}
        skeleton="none"
      />

      {records.length > 0 && (
        <div>
          {records.map((r) => (
            <div key={r.id} className="list-row">
              {r.thumbnail && <img src={r.thumbnail} alt="" className="list-thumb" />}
              <div className="list-main">
                <div className="list-title">{r.contentName || r.contentId}</div>
                <div className="list-sub">
                  <button
                    type="button"
                    className="link-user"
                    onClick={() => navigate({ name: 'creator', username: r.username })}
                  >
                    @{r.username}
                  </button>
                  {' · '}
                  <span>{formatSize(r.fileSize)}</span>
                  {' · '}
                  <span>{new Date(r.downloadedAt).toLocaleDateString()}</span>
                </div>
              </div>
              {r.filePath && (
                <button
                  className="btn btn-sm"
                  disabled={openingId === r.id}
                  onClick={() => openFile(r)}
                >
                  Open
                </button>
              )}
            </div>
          ))}
          {/* The query is capped — a full page means older rows exist unseen. */}
          {records.length === HISTORY_LIMIT && (
            <div className="readout" style={{ marginTop: 14 }}>
              showing the latest {HISTORY_LIMIT}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
