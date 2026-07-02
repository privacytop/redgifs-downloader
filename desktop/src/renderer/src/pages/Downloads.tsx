import { useEffect, useState } from 'react'
import type { DownloadTask } from '@shared/types'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'

export default function Downloads(): JSX.Element {
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const refresh = (): void => {
    window.api.listDownloads().then(setTasks)
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
      {tasks.length === 0 ? (
        <EmptyState message="No active downloads" hint="Queued transfers will appear here." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tasks.map((t) => (
            <div key={t.id} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <strong style={{ fontFamily: 'var(--serif)', fontWeight: 560, color: 'var(--cream)' }}>
                  {t.username || t.id.slice(0, 8)}
                </strong>
                <span
                  className="kicker"
                  style={{
                    color:
                      t.status === 'completed'
                        ? 'var(--ok)'
                        : t.status === 'failed' || t.status === 'cancelled'
                          ? 'var(--danger)'
                          : 'var(--mut)'
                  }}
                >
                  {t.status}
                </span>
                <span style={{ flex: 1 }} />
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
              <div className="kicker" style={{ marginTop: 10, color: 'var(--dim)' }}>
                {t.downloaded}/{t.totalItems} · {t.failed} failed · {t.skipped} skipped
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
