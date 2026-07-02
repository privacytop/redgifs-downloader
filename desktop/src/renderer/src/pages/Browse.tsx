import { useState } from 'react'
import type { Content, ToastType } from '@shared/types'

export default function Browse({ notify }: { notify: (m: string, t?: ToastType) => void }): JSX.Element {
  const [username, setUsername] = useState('')
  const [order, setOrder] = useState('best')
  const [items, setItems] = useState<Content[]>([])
  const [loading, setLoading] = useState(false)

  async function search(): Promise<void> {
    if (!username.trim()) return
    setLoading(true)
    try {
      const r = await window.api.getUserContent(username.trim(), order, 1)
      setItems(r.contents)
      if (r.contents.length === 0) notify('No results', 'info')
    } catch (e) {
      notify('Search failed: ' + (e as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function downloadAll(): Promise<void> {
    try {
      await window.api.startDownload({ type: 'user', username: username.trim(), searchOrders: [order] })
      notify('Download started for ' + username, 'success')
    } catch (e) {
      notify('Download failed: ' + (e as Error).message, 'error')
    }
  }

  return (
    <div className="page">
      <h1>Browse Users</h1>
      <div className="toolbar">
        <input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()} />
        <select value={order} onChange={(e) => setOrder(e.target.value)}>
          {['best', 'recent', 'top', 'trending'].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button className="btn" onClick={search} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
        {items.length > 0 && <button className="btn btn-primary" onClick={downloadAll}>Download All</button>}
      </div>
      <div className="grid">
        {items.map((c) => (
          <div key={c.id} className="card">
            {c.urls.thumbnail && <img src={c.urls.thumbnail} loading="lazy" alt="" />}
            <div className="card-meta">{c.views.toLocaleString()} views</div>
          </div>
        ))}
      </div>
    </div>
  )
}
