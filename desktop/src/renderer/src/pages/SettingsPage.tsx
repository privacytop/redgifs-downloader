import { useEffect, useState } from 'react'
import type { Settings, ToastType } from '@shared/types'
import PageHeader from '../components/PageHeader'
import { useThumbnailMode, type ThumbMode } from '../hooks/useThumbnailMode'

const fieldStyle: React.CSSProperties = { display: 'block', marginBottom: 20, maxWidth: 460 }
const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--dim)',
  marginBottom: 8,
  display: 'block'
}
const checkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginBottom: 14,
  fontSize: 13.5,
  color: 'var(--ink)'
}

const THUMB_MODES: { id: ThumbMode; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'auto', label: 'Auto' },
  { id: 'middle', label: 'Middle' },
  { id: 'random', label: 'Random' }
]

export default function SettingsPage({ notify }: { notify: (m: string, t?: ToastType) => void }): JSX.Element {
  const [s, setS] = useState<Settings | null>(null)
  const [thumbMode, setThumbMode] = useThumbnailMode()
  useEffect(() => {
    window.api.getSettings().then(setS)
  }, [])

  if (!s) {
    return (
      <div className="page">
        <PageHeader kicker="preferences" kickerIndex={9} title="Settings" />
      </div>
    )
  }

  const set = <K extends keyof Settings>(k: K, v: Settings[K]): void => setS({ ...s, [k]: v })

  async function save(): Promise<void> {
    try {
      await window.api.updateSettings(s!)
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

      <div style={fieldStyle}>
        <span style={labelStyle}>Download folder</span>
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

      <div style={fieldStyle}>
        <span style={labelStyle}>Max concurrent downloads</span>
        <input
          type="number"
          min={1}
          max={16}
          value={s.maxConcurrentDownloads}
          onChange={(e) => set('maxConcurrentDownloads', Number(e.target.value))}
        />
      </div>

      <div style={fieldStyle}>
        <span style={labelStyle}>Quality</span>
        <select
          value={s.preferredQuality}
          onChange={(e) => set('preferredQuality', e.target.value as Settings['preferredQuality'])}
        >
          <option value="hd">HD</option>
          <option value="sd">SD</option>
        </select>
      </div>

      <div style={fieldStyle}>
        <span style={labelStyle}>Thumbnail frame</span>
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
        <span
          style={{
            display: 'block',
            marginTop: 8,
            fontFamily: 'var(--mono)',
            fontSize: 11,
            letterSpacing: '0.04em',
            color: 'var(--dim)'
          }}
        >
          Auto swaps a video frame in when a thumbnail is near-black.
        </span>
      </div>

      <label style={checkStyle}>
        <input
          type="checkbox"
          checked={s.createUserFolders}
          onChange={(e) => set('createUserFolders', e.target.checked)}
        />
        Create per-user folders
      </label>
      <label style={checkStyle}>
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
    </div>
  )
}
