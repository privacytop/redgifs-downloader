import { useEffect, useState } from 'react'
import type { Settings, ToastType } from '@shared/types'

export default function SettingsPage({ notify }: { notify: (m: string, t?: ToastType) => void }): JSX.Element {
  const [s, setS] = useState<Settings | null>(null)
  useEffect(() => { window.api.getSettings().then(setS) }, [])
  if (!s) return <div className="page"><h1>Settings</h1></div>

  const set = <K extends keyof Settings>(k: K, v: Settings[K]): void => setS({ ...s, [k]: v })

  async function save(): Promise<void> {
    try { await window.api.updateSettings(s!); notify('Settings saved', 'success') }
    catch (e) { notify('Save failed: ' + (e as Error).message, 'error') }
  }
  async function pick(): Promise<void> {
    const p = await window.api.pickFolder(); if (p) set('downloadPath', p)
  }

  return (
    <div className="page">
      <h1>Settings</h1>
      <label>Download folder
        <div className="row"><input value={s.downloadPath} onChange={(e) => set('downloadPath', e.target.value)} />
          <button className="btn" onClick={pick}>Browse…</button></div>
      </label>
      <label>Max concurrent downloads
        <input type="number" min={1} max={16} value={s.maxConcurrentDownloads}
          onChange={(e) => set('maxConcurrentDownloads', Number(e.target.value))} /></label>
      <label>Quality
        <select value={s.preferredQuality} onChange={(e) => set('preferredQuality', e.target.value as Settings['preferredQuality'])}>
          <option value="hd">HD</option><option value="sd">SD</option></select></label>
      <label className="check"><input type="checkbox" checked={s.createUserFolders}
        onChange={(e) => set('createUserFolders', e.target.checked)} /> Create per-user folders</label>
      <label className="check"><input type="checkbox" checked={s.overwriteExisting}
        onChange={(e) => set('overwriteExisting', e.target.checked)} /> Overwrite existing files</label>
      <button className="btn btn-primary" onClick={save}>Save</button>
    </div>
  )
}
