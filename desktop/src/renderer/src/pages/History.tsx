import { useState } from 'react'
import type { DownloadRecord, Statistics } from '@shared/types'
import PageHeader from '../components/PageHeader'
import FeedState from '../components/FeedState'
import { useNav } from '../context/nav'
import { useNotify } from '../context/notify'
import { useCachedResource } from '../hooks/useCachedResource'
import { formatSize, formatCount, formatDuration } from '../lib/format'

/** getHistory is capped at this many rows; a full page means "there's more". */
const HISTORY_LIMIT = 200

const MS_PER_DAY = 86_400_000

/**
 * Day heading for a record timestamp (ms). `todayStart` is midnight of the
 * current day so the whole render pass shares one clock reading.
 */
function dayLabel(ts: number, todayStart: number): string {
  const d = new Date(ts)
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  // Rounding absorbs DST offsets (a "day" of 23/25 hours still rounds to 1).
  const days = Math.round((todayStart - dayStart) / MS_PER_DAY)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Film-slab stand-in for a thumbnail. RedGifs preview URLs are signed and
 * expire, so old rows would otherwise render as broken images forever.
 */
function ThumbFallback(): JSX.Element {
  return (
    <div className="list-thumb-fallback" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M7 3v18" />
        <path d="M17 3v18" />
        <path d="M3 7.5h4" />
        <path d="M3 12h18" />
        <path d="M3 16.5h4" />
        <path d="M17 7.5h4" />
        <path d="M17 16.5h4" />
      </svg>
    </div>
  )
}

interface Stat {
  label: string
  value: string
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
  // Rows whose signed thumbnail URL has expired (the <img> errored).
  const [deadThumbs, setDeadThumbs] = useState<ReadonlySet<number>>(new Set())

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

  const markThumbDead = (id: number): void => {
    setDeadThumbs((s) => new Set(s).add(id))
  }

  const topUser = stats?.topUsers?.[0]
  const line: Stat[] = [
    { label: 'Downloads', value: stats ? formatCount(stats.totalDownloads) : '—' },
    { label: 'On disk', value: stats ? formatSize(stats.totalSize) : '—' },
    { label: 'Creators', value: stats ? formatCount(stats.totalUsers) : '—' }
  ]
  if (topUser) {
    line.push({ label: 'Most saved', value: '@' + topUser.username })
  }

  // Rows arrive newest-first (ORDER BY downloaded_at DESC), so one linear
  // pass splits them into contiguous day groups.
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const groups: { label: string; rows: DownloadRecord[] }[] = []
  for (const r of records) {
    const label = dayLabel(r.downloadedAt, todayStart)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.rows.push(r)
    else groups.push({ label, rows: [r] })
  }

  return (
    <div className="page">
      <PageHeader kicker="library" kickerIndex={8} title="History" />

      <div className="statset" style={{ marginBottom: 30 }}>
        {line.map((s) => (
          <div key={s.label} className="stat">
            <div className="stat-n">{s.value}</div>
            <div className="stat-l">{s.label}</div>
          </div>
        ))}
        {/* A failed stats fetch would otherwise leave "—" readouts forever. */}
        {statsError && (
          <div className="stat">
            <button
              type="button"
              className="btn btn-sm"
              disabled={statsLoading}
              onClick={refreshStats}
            >
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

      {groups.map((g) => (
        <section key={g.label} style={{ marginBottom: 26 }}>
          <div className="section-label">{g.label}</div>
          {g.rows.map((r) => (
            <div key={r.id} className="list-row">
              {r.thumbnail && !deadThumbs.has(r.id) ? (
                <img
                  src={r.thumbnail}
                  alt=""
                  className="list-thumb"
                  loading="lazy"
                  onError={() => markThumbDead(r.id)}
                />
              ) : (
                <ThumbFallback />
              )}
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
                  {formatSize(r.fileSize)}
                  {r.duration > 0 && <> · {formatDuration(r.duration)}</>}
                </div>
              </div>
              {r.filePath && (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={openingId === r.id}
                  onClick={() => openFile(r)}
                >
                  Open
                </button>
              )}
            </div>
          ))}
        </section>
      ))}

      {/* The query is capped — a full page means older rows exist unseen. */}
      {records.length === HISTORY_LIMIT && (
        <div className="readout">showing the latest {HISTORY_LIMIT}</div>
      )}
    </div>
  )
}
