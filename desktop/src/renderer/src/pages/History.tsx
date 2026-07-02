import { useEffect, useState } from 'react'
import type { DownloadRecord, Statistics } from '@shared/types'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { formatSize, formatCount } from '../lib/format'

interface Tile {
  label: string
  value: string
}

function StatTile({ label, value }: Tile): JSX.Element {
  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 0,
        padding: '14px 16px',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 10
      }}
    >
      <div
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 9.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--dim)',
          marginBottom: 8
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 20,
          color: 'var(--cream)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {value}
      </div>
    </div>
  )
}

export default function History(): JSX.Element {
  const [records, setRecords] = useState<DownloadRecord[]>([])
  const [stats, setStats] = useState<Statistics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    Promise.all([window.api.getHistory(undefined, 200), window.api.getStats()])
      .then(([recs, st]) => {
        if (!alive) return
        setRecords(recs)
        setStats(st)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const topUser = stats?.topUsers?.[0]

  const tiles: Tile[] = [
    { label: 'Total downloads', value: stats ? formatCount(stats.totalDownloads) : '—' },
    { label: 'Total size', value: stats ? formatSize(stats.totalSize) : '—' },
    { label: 'Users', value: stats ? String(stats.totalUsers) : '—' }
  ]
  if (topUser) {
    tiles.push({ label: 'Top user', value: '@' + topUser.username })
  }

  return (
    <div className="page">
      <PageHeader kicker="library" kickerIndex={8} title="History" />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        {tiles.map((t) => (
          <StatTile key={t.label} label={t.label} value={t.value} />
        ))}
      </div>

      {!loading && records.length === 0 && (
        <EmptyState
          message="No downloads yet"
          hint="Saved content will be logged here with its details."
        />
      )}

      {records.length > 0 && (
        <div>
          {records.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 0',
                borderBottom: '1px solid var(--line)'
              }}
            >
              {r.thumbnail && (
                <img
                  src={r.thumbnail}
                  alt=""
                  style={{
                    width: 64,
                    height: 40,
                    objectFit: 'cover',
                    borderRadius: 5,
                    border: '1px solid var(--line)',
                    flexShrink: 0,
                    background: 'var(--panel)'
                  }}
                />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontFamily: 'var(--serif)',
                    fontSize: 15,
                    fontWeight: 560,
                    color: 'var(--cream)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  {r.contentName || r.contentId}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10.5,
                    color: 'var(--mut)',
                    marginTop: 4,
                    display: 'flex',
                    gap: 10,
                    flexWrap: 'wrap'
                  }}
                >
                  <span style={{ color: 'var(--ember)' }}>@{r.username}</span>
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
