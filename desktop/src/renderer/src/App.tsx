import { useEffect, useState } from 'react'
import Browse from './pages/Browse'
import Downloads from './pages/Downloads'
import SettingsPage from './pages/SettingsPage'
import Toasts, { useToasts } from './components/Toasts'
import type { AuthStatus } from '@shared/types'

type Page = 'browse' | 'downloads' | 'settings'
const NAV: { id: Page; label: string }[] = [
  { id: 'browse', label: 'Browse' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'settings', label: 'Settings' }
]

export default function App(): JSX.Element {
  const [page, setPage] = useState<Page>('browse')
  const [auth, setAuth] = useState<AuthStatus>({ authenticated: false })
  const toasts = useToasts()

  useEffect(() => {
    window.api.authStatus().then(setAuth)
    const offToast = window.api.on('evt:toast', (t) => toasts.push(t.message, t.type))
    const offAuth = window.api.on('evt:auth:changed', (s) => {
      setAuth(s)
      toasts.push(s.authenticated ? 'Logged in' : 'Logged out', s.authenticated ? 'success' : 'info')
    })
    return () => { offToast(); offAuth() }
  }, [])

  async function toggleAuth(): Promise<void> {
    if (auth.authenticated) await window.api.logout()
    else await window.api.login()
  }

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
        <div className="auth-box">
          <span className={`auth-dot ${auth.authenticated ? 'on' : ''}`} />
          {auth.authenticated ? 'Logged in' : 'Not logged in'}
          <button className="btn btn-sm" onClick={toggleAuth}>{auth.authenticated ? 'Logout' : 'Login'}</button>
        </div>
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
