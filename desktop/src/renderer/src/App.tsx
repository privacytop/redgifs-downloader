import { useEffect, useMemo, useState } from 'react'
import Downloads from './pages/Downloads'
import SettingsPage from './pages/SettingsPage'
import ForYou from './pages/ForYou'
import Discover from './pages/Discover'
import Following from './pages/Following'
import Niches from './pages/Niches'
import Collections from './pages/Collections'
import Likes from './pages/Likes'
import History from './pages/History'
import Account from './pages/Account'
import Creator from './pages/Creator'
import CollectionDetail from './pages/CollectionDetail'
import NicheDetail from './pages/NicheDetail'
import Toasts, { useToasts } from './components/Toasts'
import { NotifyProvider } from './context/notify'
import { NavProvider, useNav } from './context/nav'
import type { Route } from './context/nav'
import { PlayerProvider } from './player/PlayerProvider'
import type { AuthStatus, DownloadTask } from '@shared/types'

// Top-level nav routes reachable from the sidebar (the param-less routes).
type NavName = Extract<Route, { name: string; username?: undefined; id?: undefined }>['name']

interface NavItem {
  id: NavName
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

const ACTIVE_STATUSES: DownloadTask['status'][] = ['queued', 'downloading', 'paused']

/** Renders the page component for the active route. */
function RoutedPage({
  route,
  notify
}: {
  route: Route
  notify: (m: string, t?: import('@shared/types').ToastType) => void
}): JSX.Element {
  switch (route.name) {
    case 'for-you':
      return <ForYou />
    case 'discover':
      return <Discover />
    case 'following':
      return <Following />
    case 'niches':
      return <Niches />
    case 'collections':
      return <Collections />
    case 'likes':
      return <Likes />
    case 'downloads':
      return <Downloads />
    case 'history':
      return <History />
    case 'settings':
      return <SettingsPage notify={notify} />
    case 'account':
      return <Account />
    case 'creator':
      return <Creator username={route.username} />
    case 'collection':
      return <CollectionDetail id={route.id} title={route.title} />
    case 'niche':
      return <NicheDetail id={route.id} title={route.title} />
  }
}

/** App shell: sidebar + routed content. Consumes nav/notify contexts. */
function Shell({
  auth,
  activeDownloads,
  onSignIn,
  onSignOut,
  notify,
  toastItems
}: {
  auth: AuthStatus
  activeDownloads: number
  onSignIn: () => void
  onSignOut: () => void
  notify: (m: string, t?: import('@shared/types').ToastType) => void
  toastItems: ReturnType<typeof useToasts>['items']
}): JSX.Element {
  const { route, navigate, back, canBack } = useNav()
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
              const isActive = route.name === item.id
              const count = item.id === 'downloads' ? activeDownloads : 0
              return (
                <button
                  key={item.id}
                  className={`nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => navigate({ name: item.id })}
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
                onClick={() => navigate({ name: 'account' })}
              >
                {auth.username ? `@${auth.username}` : 'Signed in'}
              </button>
              <button className="btn btn-sm" onClick={onSignOut} title="Sign out">
                Out
              </button>
            </>
          ) : (
            <>
              <div className="acct-avatar" aria-hidden="true">·</div>
              <div className="acct-name">
                <div className="acct-sub">Not signed in</div>
              </div>
              <button className="btn btn-ember btn-sm" onClick={onSignIn}>
                Sign in
              </button>
            </>
          )}
        </div>
      </aside>

      <main className="content">
        {canBack && (
          <button className="shell-back btn btn-ghost btn-sm" onClick={back} title="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back
          </button>
        )}
        <RoutedPage route={route} notify={notify} />
      </main>

      <Toasts items={toastItems} />
    </div>
  )
}

export default function App(): JSX.Element {
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

  return (
    <NotifyProvider value={toasts.push}>
      <NavProvider>
        <PlayerProvider>
          <Shell
            auth={auth}
            activeDownloads={activeDownloads}
            onSignIn={signIn}
            onSignOut={signOut}
            notify={toasts.push}
            toastItems={toasts.items}
          />
        </PlayerProvider>
      </NavProvider>
    </NotifyProvider>
  )
}
