import { useEffect, useState } from 'react'
import type { DownloadTask, TaskStatus } from '@shared/types'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { formatCount } from '../lib/format'

/** Maps a task status to its readout colour token. */
function statusColor(status: TaskStatus): string {
  if (status === 'completed') return 'var(--ok)'
  if (status === 'failed' || status === 'cancelled') return 'var(--danger)'
  return 'var(--mut)'
}

export default function Downloads(): JSX.Element {
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = (): void => {
    window.api
      .listDownloads()
      .then((xs) => {
        setTasks(xs)
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    const upsert = (t: DownloadTask): void =>
      setTasks((xs) => {
        const i = xs.findIndex((x) => x.id === t.id)
        if (i === -1) return [...xs, t]
        const c = xs.slice()
        c[i] = t
        return c
      })
    const offP = window.api.on('evt:download:progress', upsert)
    const offU = window.api.on('evt:download:updated', upsert)
    return () => {
      offP()
      offU()
    }
  }, [])

  return (
    <div className="page">
      <PageHeader kicker="library" kickerIndex={7} title="Downloads" />
      {loading ? null : error && tasks.length === 0 ? (
        <EmptyState
          message="Couldn’t load"
          hint={error}
          action={
            <button className="btn" onClick={refresh}>
              Try again
            </button>
          }
        />
      ) : tasks.length === 0 ? (
        <EmptyState message="No active downloads" hint="Queued transfers will appear here." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tasks.map((t) => (
            <div key={t.id} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div className="list-main">
                  <div className="list-title">{t.username || t.id.slice(0, 8)}</div>
                </div>
                <span className="kicker" style={{ color: statusColor(t.status) }}>
                  {t.status}
                </span>
                {t.status === 'downloading' && (
                  <button className="btn btn-sm" onClick={() => window.api.pauseDownload(t.id)}>
                    Pause
                  </button>
                )}
                {t.status === 'paused' && (
                  <button className="btn btn-sm" onClick={() => window.api.resumeDownload(t.id)}>
                    Resume
                  </button>
                )}
                {(t.status === 'downloading' || t.status === 'paused' || t.status === 'queued') && (
                  <button className="btn btn-sm btn-danger" onClick={() => window.api.cancelDownload(t.id)}>
                    Cancel
                  </button>
                )}
              </div>
              <div className="prog">
                <i style={{ width: `${t.progress}%` }} />
              </div>
              <div className="list-sub" style={{ marginTop: 10 }}>
                {formatCount(t.downloaded)}/{formatCount(t.totalItems)} · {formatCount(t.failed)} failed ·{' '}
                {formatCount(t.skipped)} skipped
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
