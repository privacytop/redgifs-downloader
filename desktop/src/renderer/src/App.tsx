import { useEffect, useMemo, useState } from 'react'
import Downloads from './pages/Downloads'
import SettingsPage from './pages/SettingsPage'
import Stub from './pages/Stub'
import Toasts, { useToasts } from './components/Toasts'
import type { AuthStatus, DownloadTask } from '@shared/types'

type Page =
  | 'for-you'
  | 'discover'
  | 'following'
  | 'niches'
  | 'collections'
  | 'likes'
  | 'downloads'
  | 'history'
  | 'settings'
  | 'account'

interface NavItem {
  id: Page
  label: string
}
interface NavGroup {
  label: string
  items: NavItem[]
}

const GROUPS: NavGroup[] = [
  {
    label: 'Feeds',
    items: [
      { id: 'for-you', label: 'For you' },
      { id: 'discover', label: 'Discover' },
      { id: 'following', label: 'Following' },
      { id: 'niches', label: 'Niches' }
    ]
  },
  {
    label: 'Library',
    items: [
      { id: 'collections', label: 'Collections' },
      { id: 'likes', label: 'Likes' },
      { id: 'downloads', label: 'Downloads' },
      { id: 'history', label: 'History' }
    ]
  }
]

// Kicker numbering + copy for each screen's PageHeader.
const PAGE_META: Record<Page, { title: string; kicker: string; index: number }> = {
  'for-you': { title: 'For you', kicker: 'for you', index: 1 },
  discover: { title: 'Discover', kicker: 'discover', index: 2 },
  following: { title: 'Following', kicker: 'following', index: 3 },
  niches: { title: 'Niches', kicker: 'niches', index: 4 },
  collections: { title: 'Collections', kicker: 'library', index: 5 },
  likes: { title: 'Likes', kicker: 'library', index: 6 },
  downloads: { title: 'Downloads', kicker: 'library', index: 7 },
  history: { title: 'History', kicker: 'library', index: 8 },
  settings: { title: 'Settings', kicker: 'preferences', index: 9 },
  account: { title: 'Account', kicker: 'you', index: 10 }
}

const ACTIVE_STATUSES: DownloadTask['status'][] = ['queued', 'downloading', 'paused']

export default function App(): JSX.Element {
  const [page, setPage] = useState<Page>('for-you')
  const [auth, setAuth] = useState<AuthStatus>({ authenticated: false })
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const toasts = useToasts()

  useEffect(() => {
    window.api.authStatus().then(setAuth)
    window.api.listDownloads().then(setTasks).catch(() => {})

    const offToast = window.api.on('evt:toast', (t) => toasts.push(t.message, t.type))
    const offAuth = window.api.on('evt:auth:changed', (s) => {
      setAuth(s)
      toasts.push(
        s.authenticated ? 'Signed in' : 'Signed out',
        s.authenticated ? 'success' : 'info'
      )
    })

    const upsert = (t: DownloadTask): void =>
      setTasks((xs) => {
        const i = xs.findIndex((x) => x.id === t.id)
        if (i === -1) return [...xs, t]
        const c = xs.slice()
        c[i] = t
        return c
      })
    const offProg = window.api.on('evt:download:progress', upsert)
    const offUpd = window.api.on('evt:download:updated', upsert)

    return () => {
      offToast()
      offAuth()
      offProg()
      offUpd()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeDownloads = useMemo(
    () => tasks.filter((t) => ACTIVE_STATUSES.includes(t.status)).length,
    [tasks]
  )

  async function signIn(): Promise<void> {
    try {
      await window.api.login()
    } catch (e) {
      toasts.push('Sign in failed: ' + (e as Error).message, 'error')
    }
  }
  async function signOut(): Promise<void> {
    try {
      await window.api.logout()
    } catch (e) {
      toasts.push('Sign out failed: ' + (e as Error).message, 'error')
    }
  }

  const meta = PAGE_META[page]
  const avatarLetter = (auth.username?.[0] ?? '?').toUpperCase()

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="wordmark">
          RedGifs<span className="dot">.</span>
        </div>

        {GROUPS.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map((item) => {
              const isActive = page === item.id
              const count = item.id === 'downloads' ? activeDownloads : 0
              return (
                <button
                  key={item.id}
                  className={`nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setPage(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="nav-text">{item.label}</span>
                  {count > 0 && <span className="nav-count">{count}</span>}
                </button>
              )
            })}
          </div>
        ))}

        <div className="acct">
          {auth.authenticated ? (
            <>
              <div className="acct-avatar" aria-hidden="true">{avatarLetter}</div>
              <button
                className="acct-name btn-ghost"
                style={{ border: 0, background: 'none', textAlign: 'left', padding: 0, cursor: 'pointer' }}
                title="View account"
                onClick={() => setPage('account')}
              >
                {auth.username ? `@${auth.username}` : 'Signed in'}
              </button>
              <button className="btn btn-sm" onClick={signOut} title="Sign out">
                Out
              </button>
            </>
          ) : (
            <>
              <div className="acct-avatar" aria-hidden="true">·</div>
              <div className="acct-name">
                <div className="acct-sub">Not signed in</div>
              </div>
              <button className="btn btn-ember btn-sm" onClick={signIn}>
                Sign in
              </button>
            </>
          )}
        </div>
      </aside>

      <main className="content">
        {page === 'downloads' && <Downloads />}
        {page === 'settings' && <SettingsPage notify={toasts.push} />}
        {page !== 'downloads' && page !== 'settings' && (
          <Stub title={meta.title} kicker={meta.kicker} kickerIndex={meta.index} />
        )}
      </main>

      <Toasts items={toasts.items} />
    </div>
  )
}
