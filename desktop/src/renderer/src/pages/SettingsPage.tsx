import { useEffect, useState } from 'react'
import type { Settings, ToastType } from '@shared/types'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useThumbnailMode, type ThumbMode } from '../hooks/useThumbnailMode'

const THUMB_MODES: { id: ThumbMode; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'auto', label: 'Auto' },
  { id: 'middle', label: 'Middle' },
  { id: 'random', label: 'Random' }
]

export default function SettingsPage({ notify }: { notify: (m: string, t?: ToastType) => void }): JSX.Element {
  const [s, setS] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [thumbMode, setThumbMode] = useThumbnailMode()

  useEffect(() => {
    window.api
      .getSettings()
      .then((v) => {
        setS(v)
        setError(null)
      })
      .catch((e) => setError((e as Error).message))
  }, [])

  const set = <K extends keyof Settings>(k: K, v: Settings[K]): void => {
    if (s) setS({ ...s, [k]: v })
  }

  async function save(): Promise<void> {
    if (!s) return
    try {
      await window.api.updateSettings(s)
      notify('Settings saved', 'success')
    } catch (e) {
      notify('Save failed: ' + (e as Error).message, 'error')
    }
  }
  async function pick(): Promise<void> {
    const p = await window.api.pickFolder()
    if (p) set('downloadPath', p)
  }

  return (
    <div className="page">
      <PageHeader kicker="preferences" kickerIndex={9} title="Settings" />

      {error ? (
        <EmptyState message="Couldn't load settings" hint={error} />
      ) : !s ? null : (
        <>
          <div className="field">
            <span className="field-label">Download folder</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ flex: 1 }}
                value={s.downloadPath}
                onChange={(e) => set('downloadPath', e.target.value)}
              />
              <button className="btn" onClick={pick}>
                Browse…
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
            />
          </div>

          <div className="field">
            <span className="field-label">Quality</span>
            <select
              value={s.preferredQuality}
              onChange={(e) => set('preferredQuality', e.target.value as Settings['preferredQuality'])}
            >
              <option value="hd">HD</option>
              <option value="sd">SD</option>
            </select>
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
              Auto swaps a video frame in when a thumbnail is near-black.
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

          <button className="btn btn-ember" style={{ marginTop: 8 }} onClick={save}>
            Save changes
          </button>
        </>
      )}
    </div>
  )
}
