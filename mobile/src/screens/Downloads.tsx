import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useDownloads, type DownloadTask } from '../context/downloads'
import { useToast } from '../context/toast'
import { MediaSaver } from '../plugins/mediaSaver'
import type { DownloadRecord } from '@redloader/core'
import { storage } from '../lib/storage'
import { formatSize } from '../lib/format'
import ScreenHeader from '../components/ScreenHeader'
import IconButton from '../components/IconButton'
import { CachedImage } from '../components/CachedMedia'
import { IconX } from '../components/icons'
import '../styles/downloads.css'

function pill(t: DownloadTask): { cls: string; text: string } {
  if (t.status === 'completed') return { cls: 'pill pill-ok', text: 'done' }
  if (t.status === 'failed') return { cls: 'pill pill-err', text: 'failed' }
  if (t.status === 'cancelled') return { cls: 'pill', text: 'cancelled' }
  return { cls: 'pill pill-run', text: 'saving' }
}

function ActiveCard({ task, onCancel }: { task: DownloadTask; onCancel: (id: string) => void }): React.JSX.Element {
  const settled = task.done + task.failed
  const pct = task.total ? Math.round((settled / task.total) * 100) : 0
  return (
    <div className="dl-card">
      <div className="dl-card-top">
        <div className="dl-card-main">
          <div className="dl-card-title">{task.label}</div>
          <div className="dl-meta">
            {settled}/{task.total}
            {task.failed ? ` · ${task.failed} failed` : ''}
            {task.current ? <> · <b>@{task.current}</b></> : null}
          </div>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => onCancel(task.id)}>
          Cancel
        </button>
      </div>
      <div className="prog">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

interface FinishedRowProps {
  task: DownloadTask
  onRetry: (id: string) => void
  onRemove: (id: string) => void
}

function FinishedRow({ task, onRetry, onRemove }: FinishedRowProps): React.JSX.Element {
  const p = pill(task)
  const canRetry = task.status === 'failed' || task.status === 'cancelled'
  return (
    <div className="dl-row">
      <span className={p.cls}>{p.text}</span>
      <div className="dl-row-main">
        <div className="dl-row-title">{task.label}</div>
        <div className="dl-meta">
          {task.done}/{task.total} saved{task.failed ? ` · ${task.failed} failed` : ''}
        </div>
        {task.error ? <div className="dl-err">{task.error}</div> : null}
      </div>
      {canRetry && (
        <button type="button" className="btn btn-sm" onClick={() => onRetry(task.id)}>
          Retry remaining
        </button>
      )}
      <IconButton label="Remove from list" onClick={() => onRemove(task.id)}>
        <IconX />
      </IconButton>
    </div>
  )
}

interface ClipTileProps {
  record: DownloadRecord
  onOpen: (record: DownloadRecord) => void
}

const ClipTile = memo(function ClipTile({ record, onOpen }: ClipTileProps): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  const initial = (record.username || '?').charAt(0).toUpperCase()
  return (
    <button
      type="button"
      className="dl-tile"
      onClick={() => onOpen(record)}
      aria-label={`Open clip by ${record.username}`}
    >
      <div className="dl-ph">{initial}</div>
      {record.thumbnail && !broken ? (
        <CachedImage
          cacheKey={`media:${record.contentId}`}
          src={record.thumbnail}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : null}
      <div className="dl-tile-info">
        <div className="dl-tile-user">@{record.username}</div>
        {record.fileSize ? <div className="dl-tile-size">{formatSize(record.fileSize)}</div> : null}
      </div>
    </button>
  )
})

/** Download queue (active + finished) and the gallery of saved clips. */
export default function Downloads(): React.JSX.Element {
  const { tasks, cancel, retry, remove, clearFinished } = useDownloads()
  const toast = useToast()
  const [history, setHistory] = useState<DownloadRecord[]>([])

  // Re-read the history only when something actually finished (total `done`
  // moved), not on every progress tick.
  const doneSig = tasks.reduce((sum, t) => sum + t.done, 0)
  useEffect(() => {
    let alive = true
    storage
      .getHistory(300)
      .then((rows) => {
        if (alive) setHistory(rows)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [doneSig])

  const active = useMemo(() => tasks.filter((t) => t.status === 'downloading'), [tasks])
  const finished = useMemo(() => tasks.filter((t) => t.status !== 'downloading'), [tasks])
  const totalBytes = useMemo(
    () => history.reduce((sum, r) => sum + (r.fileSize || 0), 0),
    [history]
  )

  const openClip = useCallback(
    (record: DownloadRecord) => {
      MediaSaver.open({ uri: record.filePath }).catch(() => {
        toast("Couldn't open — file may have been removed", 'error')
      })
    },
    [toast]
  )

  const empty = tasks.length === 0 && history.length === 0

  return (
    <div className="page">
      <ScreenHeader title="Downloads" />

      {empty ? (
        <div className="empty">
          <div className="empty-msg">No downloads yet</div>
          <div className="empty-sub">
            Save a clip from the player or a collection — files land in your gallery under
            Movies/RedLoader. Downloads continue in the background.
          </div>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <section className="dl-section">
              <div className="dl-head">
                <div className="section-label">Saving</div>
              </div>
              {active.map((t) => (
                <ActiveCard key={t.id} task={t} onCancel={cancel} />
              ))}
            </section>
          )}

          {finished.length > 0 && (
            <section className="dl-section">
              <div className="dl-head">
                <div className="section-label">Finished</div>
                <button type="button" className="btn btn-sm" onClick={clearFinished}>
                  Clear finished
                </button>
              </div>
              <div className="dl-rows">
                {finished.map((t) => (
                  <FinishedRow key={t.id} task={t} onRetry={retry} onRemove={remove} />
                ))}
              </div>
            </section>
          )}

          {history.length > 0 && (
            <section className="dl-section">
              <div className="dl-head">
                <div className="section-label">Saved clips</div>
                <div className="dl-readout">
                  {history.length} {history.length === 1 ? 'clip' : 'clips'} · {formatSize(totalBytes)}
                </div>
              </div>
              <div className="dl-grid">
                {history.map((r) => (
                  <ClipTile key={`${r.username}:${r.contentId}:${r.downloadedAt}`} record={r} onOpen={openClip} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
