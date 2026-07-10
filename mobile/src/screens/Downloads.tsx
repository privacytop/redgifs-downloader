import { useDownloads, type DownloadTask } from '../context/downloads'

function pill(t: DownloadTask): { cls: string; text: string } {
  if (t.status === 'completed') return { cls: 'pill pill-ok', text: 'done' }
  if (t.status === 'failed') return { cls: 'pill pill-err', text: 'failed' }
  return { cls: 'pill pill-run', text: 'saving' }
}

/** Download queue: one row per batch, live progress, gallery destination. */
export default function Downloads(): React.JSX.Element {
  const { tasks } = useDownloads()

  return (
    <div className="page">
      <div className="kicker">Library</div>
      <h1 className="title">Downloads</h1>
      <hr className="rule" />

      {tasks.length === 0 ? (
        <div className="empty">
          <div className="empty-msg">No downloads yet</div>
          <div className="empty-sub">
            Save a clip from the player or a collection — files land in your gallery under
            Movies/RedLoader. Keep the screen on while downloading.
          </div>
        </div>
      ) : (
        tasks.map((t) => {
          const p = pill(t)
          const settled = t.done + t.failed
          const pct = t.total ? Math.round((settled / t.total) * 100) : 0
          return (
            <div key={t.id} className="list-row" style={{ display: 'block' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className={p.cls}>{p.text}</span>
                <div className="list-main">
                  <div className="list-title">{t.label}</div>
                  <div className="list-sub">
                    {settled}/{t.total}
                    {t.failed ? ` · ${t.failed} failed` : ''}
                    {t.status === 'downloading' && t.current ? ` · @${t.current}` : ''}
                  </div>
                </div>
              </div>
              {t.status === 'downloading' && (
                <div className="prog" style={{ marginTop: 8 }}>
                  <i style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
