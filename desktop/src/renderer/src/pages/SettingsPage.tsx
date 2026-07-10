import { useEffect, useState } from 'react'
import type { Settings, ToastType } from '@shared/types'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import QualityToggle from '../components/QualityToggle'
import { useQuality } from '../context/quality'
import { useThumbnailMode, type ThumbMode } from '../hooks/useThumbnailMode'
import { useLocalFlag } from '../hooks/useLocalFlag'

const THUMB_MODES: { id: ThumbMode; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'auto', label: 'Auto' },
  { id: 'middle', label: 'Middle' },
  { id: 'random', label: 'Random' }
]

// The download pool only supports 1–16 workers; clamp instead of erroring.
const clampConcurrency = (v: unknown): number =>
  Math.min(16, Math.max(1, Math.round(Number(v) || 1)))

// Middle-ellipsize long paths so the folder hint stays one quiet line.
const shortenPath = (p: string): string =>
  p.length <= 56 ? p : `${p.slice(0, 26)}…${p.slice(-29)}`

// `preferredQuality` is owned by QualityToggle — it persists through
// QualityProvider on every flip — so only the fields the Save button actually
// owns count toward this form's dirty state.
const fingerprint = (v: Settings): string =>
  JSON.stringify([v.downloadPath, v.maxConcurrentDownloads, v.createUserFolders, v.overwriteExisting])

export default function SettingsPage({ notify }: { notify: (m: string, t?: ToastType) => void }): JSX.Element {
  const [s, setS] = useState<Settings | null>(null)
  // Last-persisted snapshot — "dirty" means the form differs from what's on disk.
  const [saved, setSaved] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thumbMode, setThumbMode] = useThumbnailMode()
  const [collectionPreviews, setCollectionPreviews] = useLocalFlag('collectionPreviews', true)
  const { quality } = useQuality()

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

  const dirty = s !== null && saved !== null && fingerprint(s) !== fingerprint(saved)

  const set = <K extends keyof Settings>(k: K, v: Settings[K]): void => {
    if (s) setS({ ...s, [k]: v })
  }

  async function save(): Promise<void> {
    if (!s || saving) return
    const next = {
      ...s,
      // Clamp at save time too — blur may never fire (e.g. Enter from the field).
      maxConcurrentDownloads: clampConcurrency(s.maxConcurrentDownloads),
      // Never write a stale snapshot over the quality QualityToggle persisted.
      preferredQuality: quality
    }
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
          <section className="set-section">
            <div className="section-label">Downloads</div>

            <div className="set-row">
              <div className="set-main">
                <div className="set-label">Download folder</div>
                <div className="set-hint" title={s.downloadPath || undefined}>
                  {s.downloadPath ? shortenPath(s.downloadPath) : 'No folder chosen yet'}
                </div>
              </div>
              <div className="set-control">
                <button className="btn btn-sm" onClick={pick} disabled={picking}>
                  {picking ? 'Browsing…' : 'Browse…'}
                </button>
              </div>
            </div>

            <div className="set-row">
              <div className="set-main">
                <label className="set-label" htmlFor="set-concurrency">
                  Max concurrent downloads
                </label>
                <div className="set-hint">How many files transfer at once · 1–16</div>
              </div>
              <div className="set-control">
                <input
                  id="set-concurrency"
                  type="number"
                  min={1}
                  max={16}
                  value={s.maxConcurrentDownloads}
                  onChange={(e) => set('maxConcurrentDownloads', Number(e.target.value))}
                  onBlur={() => set('maxConcurrentDownloads', clampConcurrency(s.maxConcurrentDownloads))}
                />
              </div>
            </div>

            <div className="set-row">
              <div className="set-main">
                <div className="set-label">Default quality</div>
                <div className="set-hint">Used for every save · applies instantly, app-wide</div>
              </div>
              <div className="set-control">
                <QualityToggle />
              </div>
            </div>

            <div className="set-row">
              <div className="set-main">
                <label className="set-label" htmlFor="set-user-folders">
                  Per-creator folders
                </label>
                <div className="set-hint">File each save under a folder named after its creator</div>
              </div>
              <div className="set-control">
                <input
                  id="set-user-folders"
                  type="checkbox"
                  checked={s.createUserFolders}
                  onChange={(e) => set('createUserFolders', e.target.checked)}
                />
              </div>
            </div>

            <div className="set-row">
              <div className="set-main">
                <label className="set-label" htmlFor="set-overwrite">
                  Overwrite existing files
                </label>
                <div className="set-hint">Re-download over a file that is already on disk</div>
              </div>
              <div className="set-control">
                <input
                  id="set-overwrite"
                  type="checkbox"
                  checked={s.overwriteExisting}
                  onChange={(e) => set('overwriteExisting', e.target.checked)}
                />
              </div>
            </div>
          </section>

          <section className="set-section">
            <div className="section-label">Appearance</div>

            <div className="set-row">
              <div className="set-main">
                <div className="set-label">Thumbnail frame</div>
                <div className="set-hint">
                  Auto swaps in a mid-clip frame when a poster is near-black · applies immediately
                </div>
              </div>
              <div className="set-control">
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
              </div>
            </div>

            <div className="set-row">
              <div className="set-main">
                <label className="set-label" htmlFor="set-collection-previews">
                  Collection previews
                </label>
                <div className="set-hint">
                  Show cover thumbnails in the add-to-collection menu · applies immediately
                </div>
              </div>
              <div className="set-control">
                <input
                  id="set-collection-previews"
                  type="checkbox"
                  checked={collectionPreviews}
                  onChange={(e) => setCollectionPreviews(e.target.checked)}
                />
              </div>
            </div>
          </section>

          <div className="set-section">
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
