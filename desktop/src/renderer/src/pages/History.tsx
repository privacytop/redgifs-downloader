import type { DownloadRecord, Statistics } from '@shared/types'
import PageHeader from '../components/PageHeader'
import FeedState from '../components/FeedState'
import { useNav } from '../context/nav'
import { useCachedResource } from '../hooks/useCachedResource'
import { formatSize, formatCount } from '../lib/format'

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
  const {
    data: recordsData,
    loading: recordsLoading,
    error: recordsError,
    refresh: refreshRecords
  } = useCachedResource<DownloadRecord[]>('history', () => window.api.getHistory(undefined, 200), [])
  const { data: stats } = useCachedResource<Statistics>('stats', () => window.api.getStats(), [])

  const records = recordsData ?? []
  const loading = recordsLoading && recordsData === null

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
                <div className="list-sub" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => navigate({ name: 'creator', username: r.username })}
                    style={{
                      color: 'var(--ember)',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      font: 'inherit',
                      cursor: 'pointer'
                    }}
                  >
                    @{r.username}
                  </button>
                  <span>{formatSize(r.fileSize)}</span>
                  <span>{new Date(r.downloadedAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
