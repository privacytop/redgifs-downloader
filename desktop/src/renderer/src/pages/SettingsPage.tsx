import { useEffect, useState } from 'react'
import type { Settings, ToastType } from '@shared/types'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useThumbnailMode, type ThumbMode } from '../hooks/useThumbnailMode'

const QUALITIES: { id: Settings['preferredQuality']; label: string }[] = [
  { id: 'hd', label: 'HD' },
  { id: 'sd', label: 'SD' }
]

const THUMB_MODES: { id: ThumbMode; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'auto', label: 'Auto' },
  { id: 'middle', label: 'Middle' },
  { id: 'random', label: 'Random' }
]

// The download pool only supports 1–16 workers; clamp instead of erroring.
const clampConcurrency = (v: unknown): number =>
  Math.min(16, Math.max(1, Math.round(Number(v) || 1)))

export default function SettingsPage({ notify }: { notify: (m: string, t?: ToastType) => void }): JSX.Element {
  const [s, setS] = useState<Settings | null>(null)
  // Last-persisted snapshot — "dirty" means the form differs from what's on disk.
  const [saved, setSaved] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thumbMode, setThumbMode] = useThumbnailMode()

  const load = (): void => {
    window.api
      .getSettings()
      .then((v) => {
        setS(v)
        setSaved(v)
        setError(null)
      })
      .catch((e) => setError((e as Error).message))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dirty = s !== null && saved !== null && JSON.stringify(s) !== JSON.stringify(saved)

  const set = <K extends keyof Settings>(k: K, v: Settings[K]): void => {
    if (s) setS({ ...s, [k]: v })
  }

  async function save(): Promise<void> {
    if (!s || saving) return
    // Clamp at save time too — blur may never fire (e.g. Enter from the field).
    const next = { ...s, maxConcurrentDownloads: clampConcurrency(s.maxConcurrentDownloads) }
    setS(next)
    setSaving(true)
    try {
      await window.api.updateSettings(next)
      setSaved(next)
      notify('Settings saved', 'success')
    } catch (e) {
      notify('Save failed: ' + (e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function pick(): Promise<void> {
    setPicking(true)
    try {
      const p = await window.api.pickFolder()
      // Functional update — the dialog can stay open across other edits.
      if (p) setS((prev) => (prev ? { ...prev, downloadPath: p } : prev))
    } catch (e) {
      notify('Couldn’t open the folder picker: ' + (e as Error).message, 'error')
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="page">
      <PageHeader kicker="preferences" kickerIndex={9} title="Settings" />

      {error ? (
        <EmptyState
          message="Couldn't load settings"
          hint={error}
          action={
            <button className="btn" onClick={load}>
              Try again
            </button>
          }
        />
      ) : !s ? null : (
        <>
          <div className="field">
            <span className="field-label">Download folder</span>
            <div className="toolbar">
              <input
                className="field-search"
                value={s.downloadPath}
                onChange={(e) => set('downloadPath', e.target.value)}
              />
              <button className="btn" onClick={pick} disabled={picking}>
                {picking ? 'Browsing…' : 'Browse…'}
              </button>
            </div>
          </div>

          <div className="field">
            <span className="field-label">Max concurrent downloads</span>
            <input
              type="number"
              min={1}
              max={16}
              value={s.maxConcurrentDownloads}
              onChange={(e) => set('maxConcurrentDownloads', Number(e.target.value))}
              onBlur={() => set('maxConcurrentDownloads', clampConcurrency(s.maxConcurrentDownloads))}
            />
            <span className="field-hint">Between 1 and 16.</span>
          </div>

          <div className="field">
            <span className="field-label">Quality</span>
            <div className="seg" role="group" aria-label="Quality">
              {QUALITIES.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  className={s.preferredQuality === q.id ? 'on' : ''}
                  aria-pressed={s.preferredQuality === q.id}
                  onClick={() => set('preferredQuality', q.id)}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Thumbnail frame</span>
            <div className="seg" role="group" aria-label="Thumbnail frame">
              {THUMB_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={thumbMode === m.id ? 'on' : ''}
                  aria-pressed={thumbMode === m.id}
                  onClick={() => setThumbMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <span className="field-hint">
              Auto swaps a video frame in when a thumbnail is near-black. Applies immediately.
            </span>
          </div>

          <label className="field-check">
            <input
              type="checkbox"
              checked={s.createUserFolders}
              onChange={(e) => set('createUserFolders', e.target.checked)}
            />
            Create per-user folders
          </label>
          <label className="field-check">
            <input
              type="checkbox"
              checked={s.overwriteExisting}
              onChange={(e) => set('overwriteExisting', e.target.checked)}
            />
            Overwrite existing files
          </label>

          <div className="field">
            <div className="toolbar">
              <button className="btn btn-ember" onClick={save} disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {dirty && !saving && <span className="readout">Unsaved changes</span>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
