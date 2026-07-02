import { useEffect, useState } from 'react'
import type { DownloadTask } from '@shared/types'

export default function Downloads(): JSX.Element {
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const refresh = (): void => { window.api.listDownloads().then(setTasks) }

  useEffect(() => {
    refresh()
    const upsert = (t: DownloadTask): void =>
      setTasks((xs) => { const i = xs.findIndex((x) => x.id === t.id); if (i === -1) return [...xs, t]; const c = xs.slice(); c[i] = t; return c })
    const offP = window.api.on('evt:download:progress', upsert)
    const offU = window.api.on('evt:download:updated', upsert)
    return () => { offP(); offU() }
  }, [])

  if (tasks.length === 0) return <div className="page"><h1>Downloads</h1><p className="empty">No active downloads</p></div>

  return (
    <div className="page">
      <h1>Downloads</h1>
      {tasks.map((t) => (
        <div key={t.id} className="task">
          <div className="task-head">
            <strong>{t.username || t.id.slice(0, 8)}</strong>
            <span className={`status status-${t.status}`}>{t.status}</span>
            <span className="grow" />
            {t.status === 'downloading' && <button className="btn btn-sm" onClick={() => window.api.pauseDownload(t.id)}>Pause</button>}
            {t.status === 'paused' && <button className="btn btn-sm" onClick={() => window.api.resumeDownload(t.id)}>Resume</button>}
            {(t.status === 'downloading' || t.status === 'paused' || t.status === 'queued') &&
              <button className="btn btn-sm btn-danger" onClick={() => window.api.cancelDownload(t.id)}>Cancel</button>}
          </div>
          <div className="progress"><div className="progress-bar" style={{ width: `${t.progress}%` }} /></div>
          <div className="task-meta">{t.downloaded}/{t.totalItems} · {t.failed} failed · {t.skipped} skipped</div>
        </div>
      ))}
    </div>
  )
}
