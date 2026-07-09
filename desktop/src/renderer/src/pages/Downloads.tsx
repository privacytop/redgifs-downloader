import { useEffect, useState } from 'react'
import type { DownloadTask, TaskStatus } from '@shared/types'
import PageHeader from '../components/PageHeader'
import FeedState from '../components/FeedState'
import ConfirmDialog from '../components/ConfirmDialog'
import { IconX } from '../components/icons'
import { useNotify } from '../context/notify'
import { formatCount } from '../lib/format'

/** Standard inter-section rhythm (same constant Search.tsx uses). */
const sectionGap = { marginBottom: 26 } as const

/** Terminal states — grouped under "Finished" so active work stays on top. */
const FINISHED: readonly TaskStatus[] = ['completed', 'failed', 'cancelled']

/** Still-running states: these carry a progress rule and can be cancelled. */
const LIVE: readonly TaskStatus[] = ['queued', 'downloading', 'paused']

/* Pause/play have no icons.tsx entry — drawn inline with the same 24-viewBox
   stroke geometry so they sit pixel-identical next to IconX. */
const IconPause = (): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
)
const IconPlay = (): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M7 4.8 19 12 7 19.2z" />
  </svg>
)

/** Maps a task status to its status-pill accent. */
function pillClass(status: TaskStatus): string {
  if (status === 'completed') return 'pill pill-ok'
  if (status === 'failed' || status === 'cancelled') return 'pill pill-err'
  return 'pill pill-run'
}

/** Human handle for a task: the creator, or the id stub for tag/feed jobs. */
function taskLabel(t: DownloadTask): string {
  return t.username ? `@${t.username}` : t.id.slice(0, 8)
}

/** Coarse relative timestamp for finished rows ("finished 4m ago"). */
function relTime(ts: number): string {
  const d = Date.now() - ts
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return `${Math.floor(d / 86_400_000)}d ago`
}

/** One meta line per state: what's moving, why it stopped, or what it did. */
function subLine(t: DownloadTask): string {
  // Failed tasks must say why — otherwise the row is a dead end.
  if (t.status === 'failed') return t.error || 'Download failed'
  const done = formatCount(t.downloaded)
  const total = formatCount(t.totalItems)
  if (t.status === 'completed') {
    const fails = t.failed > 0 ? ` · ${formatCount(t.failed)} failed` : ''
    const when = t.endTime ? ` · finished ${relTime(t.endTime)}` : ''
    return `${done} of ${total}${fails}${when}`
  }
  if (t.status === 'cancelled') {
    const when = t.endTime ? ` · stopped ${relTime(t.endTime)}` : ''
    return `${done} of ${total}${when}`
  }
  // queued / downloading / paused — live counter plus the item in flight.
  return `${done}/${total}${t.currentItem ? ` · ${t.currentItem}` : ''}`
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
  const live = LIVE.includes(t.status)
  return (
    <div className="list-row">
      <span className={pillClass(t.status)}>{t.status}</span>
      <div className="list-main">
        <div className="list-title">
          {taskLabel(t)} · {t.type}
        </div>
        {/* Finished rows drop the rule — a full ember bar reads as "running". */}
        {live && (
          <div
            className="prog"
            role="progressbar"
            aria-label={`${taskLabel(t)} progress`}
            aria-valuenow={Math.round(t.progress)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <i style={{ width: `${t.progress}%` }} />
          </div>
        )}
        <div className="list-sub">{subLine(t)}</div>
      </div>
      {t.status === 'downloading' && (
        <button
          type="button"
          className="ibtn"
          title="Pause"
          aria-label={`Pause ${taskLabel(t)}`}
          disabled={busy}
          onClick={onPause}
        >
          <IconPause />
        </button>
      )}
      {t.status === 'paused' && (
        <button
          type="button"
          className="ibtn"
          title="Resume"
          aria-label={`Resume ${taskLabel(t)}`}
          disabled={busy}
          onClick={onResume}
        >
          <IconPlay />
        </button>
      )}
      {live && (
        <button
          type="button"
          className="ibtn"
          title="Cancel"
          aria-label={`Cancel ${taskLabel(t)}`}
          disabled={busy}
          onClick={onCancelRequest}
        >
          <IconX />
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
  // Minute tick so "finished Nm ago" doesn't freeze once events stop flowing.
  const [, setTick] = useState(0)

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

  const active = tasks.filter((t) => !FINISHED.includes(t.status))
  const finished = tasks.filter((t) => FINISHED.includes(t.status))

  useEffect(() => {
    if (finished.length === 0) return undefined
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000)
    return () => window.clearInterval(id)
  }, [finished.length])

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

  // Aggregate progress prefers real item counts; falls back to the tasks' own
  // percentages while queued jobs haven't resolved their totals yet.
  const sumItems = active.reduce((n, t) => n + t.totalItems, 0)
  const sumDone = active.reduce((n, t) => n + t.downloaded, 0)
  const sumFailed = active.reduce((n, t) => n + t.failed, 0)
  const aggPct =
    sumItems > 0
      ? Math.round((sumDone / sumItems) * 100)
      : Math.round(active.reduce((n, t) => n + t.progress, 0) / Math.max(active.length, 1))

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
        <div className="statset" style={sectionGap}>
          <div className="stat">
            <span className="stat-n">{active.length}</span>
            <span className="stat-l">active</span>
          </div>
          <div className="stat">
            <span className="stat-n">{aggPct}%</span>
            <span className="stat-l">overall</span>
          </div>
          <div className="stat">
            <span className="stat-n">{formatCount(sumDone)}</span>
            <span className="stat-l">downloaded</span>
          </div>
          <div className="stat">
            <span className="stat-n">{formatCount(sumFailed)}</span>
            <span className="stat-l">failed</span>
          </div>
        </div>
      )}

      {active.length > 0 && (
        <section style={sectionGap}>
          <div className="section-label">Active</div>
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
