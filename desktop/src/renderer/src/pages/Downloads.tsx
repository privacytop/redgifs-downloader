import { useEffect, useState } from 'react'
import type { DownloadTask, TaskStatus } from '@shared/types'
import PageHeader from '../components/PageHeader'
import FeedState from '../components/FeedState'
import ConfirmDialog from '../components/ConfirmDialog'
import { useNotify } from '../context/notify'
import { formatCount } from '../lib/format'

/** Terminal states — grouped under "Finished" so active work stays on top. */
const FINISHED: readonly TaskStatus[] = ['completed', 'failed', 'cancelled']

/** Maps a task status to its status-pill accent. */
function pillClass(status: TaskStatus): string {
  if (status === 'completed') return 'pill pill-ok'
  if (status === 'failed' || status === 'cancelled') return 'pill pill-err'
  return 'pill pill-run'
}

/** Human handle for a task: the creator, or the id stub for tag/feed jobs. */
function taskLabel(t: DownloadTask): string {
  return t.username || t.id.slice(0, 8)
}

interface RowProps {
  task: DownloadTask
  /** A pause/resume/cancel is in flight for this task. */
  busy: boolean
  onPause: () => void
  onResume: () => void
  onCancelRequest: () => void
}

function TaskRow({ task: t, busy, onPause, onResume, onCancelRequest }: RowProps): JSX.Element {
  return (
    <div className="list-row">
      <div className="list-main">
        <div className="list-title">{taskLabel(t)}</div>
        <div
          className="prog"
          role="progressbar"
          aria-valuenow={Math.round(t.progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ width: `${t.progress}%` }} />
        </div>
        <div className="list-sub">
          {formatCount(t.downloaded)}/{formatCount(t.totalItems)} · {formatCount(t.failed)} failed
          · {formatCount(t.skipped)} skipped
        </div>
        {/* Failed tasks must say why — otherwise the row is a dead end. */}
        {t.status === 'failed' && t.error && <div className="list-sub">{t.error}</div>}
      </div>
      <span className={pillClass(t.status)}>{t.status}</span>
      {t.status === 'downloading' && (
        <button className="btn btn-sm" disabled={busy} onClick={onPause}>
          Pause
        </button>
      )}
      {t.status === 'paused' && (
        <button className="btn btn-sm" disabled={busy} onClick={onResume}>
          Resume
        </button>
      )}
      {(t.status === 'downloading' || t.status === 'paused' || t.status === 'queued') && (
        <button className="btn btn-sm btn-danger" disabled={busy} onClick={onCancelRequest}>
          Cancel
        </button>
      )}
    </div>
  )
}

export default function Downloads(): JSX.Element {
  const notify = useNotify()
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Ids with a control action in flight — that row's buttons disable until the
  // promise settles, so a double-click can't race the backend task state.
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  // Cancel is irreversible, so it never fires from a single click.
  const [confirmCancel, setConfirmCancel] = useState<DownloadTask | null>(null)

  const refresh = (): void => {
    setLoading(true)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const act = (id: string, verb: string, run: () => Promise<void>): void => {
    setPending((s) => new Set(s).add(id))
    run()
      .catch((e: unknown) =>
        notify(`${verb} failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
      )
      .finally(() =>
        setPending((s) => {
          const c = new Set(s)
          c.delete(id)
          return c
        })
      )
  }

  const active = tasks.filter((t) => !FINISHED.includes(t.status))
  const finished = tasks.filter((t) => FINISHED.includes(t.status))

  const row = (t: DownloadTask): JSX.Element => (
    <TaskRow
      key={t.id}
      task={t}
      busy={pending.has(t.id)}
      onPause={() => act(t.id, 'Pause', () => window.api.pauseDownload(t.id))}
      onResume={() => act(t.id, 'Resume', () => window.api.resumeDownload(t.id))}
      onCancelRequest={() => setConfirmCancel(t)}
    />
  )

  return (
    <div className="page">
      <PageHeader kicker="library" kickerIndex={7} title="Downloads" />

      {loading && !error && tasks.length === 0 && <div className="feed-loading">Loading…</div>}
      <FeedState
        loading={loading}
        error={error}
        isEmpty={tasks.length === 0}
        emptyMessage="No active downloads"
        emptyHint="Queued transfers will appear here."
        onRetry={refresh}
        skeleton="none"
      />
      {/* A refresh failure must stay visible even while stale rows render. */}
      {error && tasks.length > 0 && (
        <div className="feed-error" role="alert">
          <span>Couldn’t refresh — {error}</span>
          <button type="button" className="btn btn-sm" disabled={loading} onClick={refresh}>
            Try again
          </button>
        </div>
      )}

      {active.length > 0 && (
        <section style={{ marginBottom: 26 }}>
          {finished.length > 0 && <div className="section-label">Active</div>}
          {active.map(row)}
        </section>
      )}
      {finished.length > 0 && (
        <section>
          <div className="section-label">Finished</div>
          {finished.map(row)}
        </section>
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="Cancel this download?"
          body={`The remaining items for ${taskLabel(confirmCancel)} will not be downloaded. A cancelled task can’t be resumed.`}
          confirmLabel="Cancel download"
          danger
          onConfirm={() => {
            act(confirmCancel.id, 'Cancel', () => window.api.cancelDownload(confirmCancel.id))
            setConfirmCancel(null)
          }}
          onCancel={() => setConfirmCancel(null)}
        />
      )}
    </div>
  )
}
