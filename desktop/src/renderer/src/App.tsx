import { useEffect, useState } from 'react'
import Browse from './pages/Browse'
import Downloads from './pages/Downloads'
import SettingsPage from './pages/SettingsPage'
import Toasts, { useToasts } from './components/Toasts'

type Page = 'browse' | 'downloads' | 'settings'
const NAV: { id: Page; label: string }[] = [
  { id: 'browse', label: 'Browse' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'settings', label: 'Settings' }
]

export default function App(): JSX.Element {
  const [page, setPage] = useState<Page>('browse')
  const toasts = useToasts()

  useEffect(() => {
    const off = window.api.on('evt:toast', (t) => toasts.push(t.message, t.type))
    return off
  }, [])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">R</span> RedGifs<small>Downloader</small></div>
        <nav>
          {NAV.map((n) => (
            <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
              {n.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">
        {page === 'browse' && <Browse notify={toasts.push} />}
        {page === 'downloads' && <Downloads />}
        {page === 'settings' && <SettingsPage notify={toasts.push} />}
      </main>
      <Toasts items={toasts.items} />
    </div>
  )
}
