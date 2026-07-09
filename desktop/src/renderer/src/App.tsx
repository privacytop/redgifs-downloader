import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Downloads from './pages/Downloads'
import SettingsPage from './pages/SettingsPage'
import ForYou from './pages/ForYou'
import Discover from './pages/Discover'
import Following from './pages/Following'
import Niches from './pages/Niches'
import ErrorBoundary from './components/ErrorBoundary'
import Collections from './pages/Collections'
import Library from './pages/Library'
import Likes from './pages/Likes'
import History from './pages/History'
import Account from './pages/Account'
import Creator from './pages/Creator'
import CollectionDetail from './pages/CollectionDetail'
import NicheDetail from './pages/NicheDetail'
import TagDetail from './pages/TagDetail'
import Search from './pages/Search'
import Toasts, { useToasts } from './components/Toasts'
import { NotifyProvider } from './context/notify'
import { BlockedTagsProvider } from './context/blockedTags'
import { QualityProvider } from './context/quality'
import { NavProvider, useNav } from './context/nav'
import type { Route } from './context/nav'
import { PlayerProvider } from './player/PlayerProvider'
import type { AuthStatus, DownloadTask } from '@shared/types'
import {
  IconBookmark,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconCompass,
  IconDownload,
  IconGear,
  IconHeart,
  IconImage,
  IconLogout,
  IconShapes,
  IconSparkles,
  IconUsers
} from './components/icons'

// Top-level nav routes reachable from the sidebar (the param-less routes).
type NavName =
  | 'for-you'
  | 'discover'
  | 'following'
  | 'niches'
  | 'collections'
  | 'likes'
  | 'library'
  | 'downloads'
  | 'history'

interface NavItem {
  id: NavName
  label: string
  icon: (p: React.SVGProps<SVGSVGElement>) => JSX.Element
}

/**
 * Which top-level nav item should read as active for a given route. Detail
 * routes map back to their parent so the sidebar item stays highlighted:
 * `collection`→`collections`, `niche`→`niches`, `creator`/`tag`/`search`→`discover`.
 */
function activeNavName(route: Route): NavName | null {
  switch (route.name) {
    case 'collection':
      return 'collections'
    case 'niche':
      return 'niches'
    case 'creator':
    case 'tag':
    case 'search':
      return 'discover'
    case 'settings':
    case 'account':
      return null
    default:
      return route.name
  }
}

/** Short trail label shown in the topbar for pushed detail routes. */
function crumbLabel(route: Route): string | null {
  switch (route.name) {
    case 'creator':
      return `@${route.username}`
    case 'tag':
      return `#${route.tag}`
    case 'search':
      return `“${route.query}”`
    case 'collection':
    case 'niche':
      return route.title
    default:
      return null
  }
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const GROUPS: NavGroup[] = [
  {
    label: 'Feeds',
    items: [
      { id: 'for-you', label: 'For you', icon: IconSparkles },
      { id: 'discover', label: 'Discover', icon: IconCompass },
      { id: 'following', label: 'Following', icon: IconUsers },
      { id: 'niches', label: 'Niches', icon: IconShapes }
    ]
  },
  {
    label: 'Library',
    items: [
      { id: 'library', label: 'All media', icon: IconImage },
      { id: 'collections', label: 'Collections', icon: IconBookmark },
      { id: 'likes', label: 'Likes', icon: IconHeart },
      { id: 'downloads', label: 'Downloads', icon: IconDownload },
      { id: 'history', label: 'History', icon: IconClock }
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
    case 'library':
      return <Library />
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
    case 'tag':
      return <TagDetail tag={route.tag} />
    case 'search':
      return <Search query={route.query} />
  }
}

/** App shell: sidebar + topbar + routed content. Consumes nav/notify contexts. */
function Shell({
  auth,
  activeDownloads,
  onSignIn,
  onSignOut,
  notify,
  toastItems,
  onToastDismiss
}: {
  auth: AuthStatus
  activeDownloads: number
  onSignIn: () => void
  onSignOut: () => void
  notify: (m: string, t?: import('@shared/types').ToastType) => void
  toastItems: ReturnType<typeof useToasts>['items']
  onToastDismiss: (id: number) => void
}): JSX.Element {
  const { route, navigate, back, forward, canBack, canForward, depth, action } = useNav()
  const avatarLetter = (auth.username?.[0] ?? '?').toUpperCase()
  const [searchTerm, setSearchTerm] = useState('')
  const [scrolled, setScrolled] = useState(false)
  const activeName = activeNavName(route)
  const crumb = crumbLabel(route)
  const routeKey = JSON.stringify(route)

  const contentRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  // Scroll offsets per stack depth: restored when walking history, dropped on reset.
  const scrollMemory = useRef<Map<number, number>>(new Map())
  const depthRef = useRef(depth)
  depthRef.current = depth

  // New page → top; back/forward → the offset that entry had when we left it.
  // Feed pages hydrate their cached content in a passive effect (after this
  // layout effect), so a deep offset can clamp against a still-short page —
  // reapply on animation frames until it sticks, bounded to ~1s.
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    let raf = 0
    if (action === 'pop' || action === 'forward') {
      const want = scrollMemory.current.get(depth) ?? 0
      el.scrollTop = want
      scrollMemory.current.set(depth, want)
      if (want > 0 && Math.abs(el.scrollTop - want) > 4) {
        let tries = 60
        const tick = (): void => {
          const c = contentRef.current
          if (!c || tries-- <= 0) return
          if (Math.abs(c.scrollTop - want) <= 4) return
          c.scrollTop = want
          scrollMemory.current.set(depth, want)
          if (Math.abs(c.scrollTop - want) > 4) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      }
    } else {
      if (action === 'reset') scrollMemory.current.clear()
      // Write the slot explicitly: scrollTop = 0 on an already-unscrolled
      // container fires no scroll event, which would leave a stale offset from
      // a previous page at this depth.
      el.scrollTop = 0
      scrollMemory.current.set(depth, 0)
    }
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey])

  // Ctrl/Cmd+K (or `/` outside a field) jumps to search — but never while a
  // modal layer (player, confirm dialog) covers the sidebar: focusing the
  // hidden input would swallow the modal's own keyboard controls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (document.querySelector('.player, .overlay')) return
      const inField =
        e.target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
      if (inField) return
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="wordmark">
          RedGifs<span className="dot">.</span>
        </div>

        <div className="sidebar-search-wrap">
          <input
            ref={searchRef}
            className="sidebar-search"
            type="search"
            value={searchTerm}
            placeholder="Search…"
            aria-label="Search"
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const q = searchTerm.trim()
                if (q) navigate({ name: 'search', query: q })
              } else if (e.key === 'Escape') {
                setSearchTerm('')
                e.currentTarget.blur()
              }
            }}
          />
          <span className="kbd">ctrl K</span>
        </div>

        {GROUPS.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map((item) => {
              const isActive = activeName === item.id
              const count = item.id === 'downloads' ? activeDownloads : 0
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  className={`nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => navigate({ name: item.id })}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="nav-ic" />
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
              <button
                className="acct-chip"
                title="View account"
                onClick={() => navigate({ name: 'account' })}
              >
                <div className="acct-avatar" aria-hidden="true">{avatarLetter}</div>
                <div className="acct-name">
                  {auth.username ? `@${auth.username}` : 'Signed in'}
                  <div className="acct-sub">Account</div>
                </div>
              </button>
              <button
                className="ibtn"
                title="Settings"
                aria-label="Settings"
                onClick={() => navigate({ name: 'settings' })}
              >
                <IconGear />
              </button>
              <button className="ibtn" title="Sign out" aria-label="Sign out" onClick={onSignOut}>
                <IconLogout />
              </button>
            </>
          ) : (
            <>
              <div className="acct-chip" style={{ cursor: 'default' }}>
                <div className="acct-avatar" aria-hidden="true">·</div>
                <div className="acct-name">
                  <div className="acct-sub">Not signed in</div>
                </div>
              </div>
              <button
                className="ibtn"
                title="Settings"
                aria-label="Settings"
                onClick={() => navigate({ name: 'settings' })}
              >
                <IconGear />
              </button>
              <button className="btn btn-ember btn-sm" onClick={onSignIn}>
                Sign in
              </button>
            </>
          )}
        </div>
      </aside>

      <main
        className="content"
        ref={contentRef}
        onScroll={(e) => {
          const top = e.currentTarget.scrollTop
          scrollMemory.current.set(depthRef.current, top)
          setScrolled(top > 8)
        }}
      >
        <div className={`topbar ${scrolled ? 'scrolled' : ''}`}>
          <button className="ibtn" onClick={back} disabled={!canBack} title="Back" aria-label="Back">
            <IconChevronLeft />
          </button>
          <button
            className="ibtn"
            onClick={forward}
            disabled={!canForward}
            title="Forward"
            aria-label="Forward"
          >
            <IconChevronRight />
          </button>
          {crumb && <span className="topbar-crumb">{crumb}</span>}
        </div>
        <ErrorBoundary resetKey={route}>
          <RoutedPage key={routeKey} route={route} notify={notify} />
        </ErrorBoundary>
      </main>

      <Toasts items={toastItems} onDismiss={onToastDismiss} />
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
      <BlockedTagsProvider>
        <QualityProvider>
          <NavProvider>
            <PlayerProvider>
              <Shell
                auth={auth}
                activeDownloads={activeDownloads}
                onSignIn={signIn}
                onSignOut={signOut}
                notify={toasts.push}
                toastItems={toasts.items}
                onToastDismiss={toasts.dismiss}
              />
            </PlayerProvider>
          </NavProvider>
        </QualityProvider>
      </BlockedTagsProvider>
    </NotifyProvider>
  )
}
