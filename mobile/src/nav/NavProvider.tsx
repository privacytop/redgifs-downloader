import {
  createContext,
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { TAB_ORDER, TAB_ROOTS, matchRoute, tabForRoot, type RouteDef, type TabId } from './routes'

/** One mounted screen in a tab's stack. */
export interface Entry {
  key: string
  path: string
  state?: unknown
}

export interface NavSnapshot {
  active: TabId
  stacks: Record<TabId, Entry[]>
}

export interface NavigateOptions {
  state?: unknown
  replace?: boolean
}

export type NavigateFn = (to: string | number, opts?: NavigateOptions) => void

interface NavApi {
  snapshot: NavSnapshot
  routes: RouteDef[]
  push: (path: string, state?: unknown) => void
  replace: (path: string, state?: unknown) => void
  /** Pop the active stack. False when already at a root. */
  pop: () => boolean
  switchTab: (tab: TabId) => void
  /**
   * Android/system back: pop the active stack, else hop to Home from another
   * tab's root. False only when on Home's root (caller may exit the app).
   */
  back: () => boolean
  /** Re-tap on the active tab: pop to its root, or scroll the root to top. */
  tapActiveTab: () => void
}

const NavCtx = createContext<NavApi | null>(null)

interface EntryCtxValue {
  entry: Entry
  tab: TabId
  params: Record<string, string>
  active: boolean
}
const EntryCtx = createContext<EntryCtxValue | null>(null)

// Deeper than this and the oldest pushed screen (never the root) is dropped so
// a long browse session can't keep hundreds of grids mounted.
const MAX_DEPTH = 8
let seq = 0
const nextKey = (): string => `s${++seq}`

function initialSnapshot(): NavSnapshot {
  const stacks = {} as Record<TabId, Entry[]>
  for (const tab of TAB_ORDER) stacks[tab] = [{ key: nextKey(), path: TAB_ROOTS[tab] }]
  return { active: 'home', stacks }
}

/**
 * Native-style navigation: five independent tab stacks, every screen in every
 * stack stays MOUNTED (hidden) so its state and scroll position survive tab
 * switches and back navigation. Replaces react-router: the hooks below mirror
 * its `useNavigate` / `useParams` / `useLocation` so screens read the same.
 */
export function NavProvider({ routes, children }: { routes: RouteDef[]; children: ReactNode }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<NavSnapshot>(initialSnapshot)
  const snapRef = useRef(snapshot)
  snapRef.current = snapshot

  const push = useCallback((path: string, state?: unknown): void => {
    const rootTab = tabForRoot(path)
    if (rootTab) {
      setSnapshot((s) => (s.active === rootTab ? s : { ...s, active: rootTab }))
      return
    }
    setSnapshot((s) => {
      const stack = s.stacks[s.active]
      const top = stack[stack.length - 1]
      // Pushing the exact screen that's already on top is a no-op (double tap).
      if (top.path === path) return s
      let next = [...stack, { key: nextKey(), path, state }]
      if (next.length > MAX_DEPTH) next = [next[0], ...next.slice(2)]
      return { ...s, stacks: { ...s.stacks, [s.active]: next } }
    })
  }, [])

  const replace = useCallback((path: string, state?: unknown): void => {
    setSnapshot((s) => {
      const stack = s.stacks[s.active]
      if (stack.length === 1) return s
      const next = [...stack.slice(0, -1), { key: nextKey(), path, state }]
      return { ...s, stacks: { ...s.stacks, [s.active]: next } }
    })
  }, [])

  const pop = useCallback((): boolean => {
    const s = snapRef.current
    if (s.stacks[s.active].length <= 1) return false
    setSnapshot((cur) => {
      const stack = cur.stacks[cur.active]
      if (stack.length <= 1) return cur
      return { ...cur, stacks: { ...cur.stacks, [cur.active]: stack.slice(0, -1) } }
    })
    return true
  }, [])

  const switchTab = useCallback((tab: TabId): void => {
    setSnapshot((s) => (s.active === tab ? s : { ...s, active: tab }))
  }, [])

  const back = useCallback((): boolean => {
    if (pop()) return true
    if (snapRef.current.active !== 'home') {
      switchTab('home')
      return true
    }
    return false
  }, [pop, switchTab])

  const tapActiveTab = useCallback((): void => {
    const s = snapRef.current
    const stack = s.stacks[s.active]
    if (stack.length > 1) {
      setSnapshot((cur) => ({ ...cur, stacks: { ...cur.stacks, [cur.active]: [cur.stacks[cur.active][0]] } }))
      return
    }
    const el = document.querySelector<HTMLElement>(`[data-screen="${stack[0].key}"]`)
    el?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const api = useMemo<NavApi>(
    () => ({ snapshot, routes, push, replace, pop, switchTab, back, tapActiveTab }),
    [snapshot, routes, push, replace, pop, switchTab, back, tapActiveTab]
  )

  return <NavCtx.Provider value={api}>{children}</NavCtx.Provider>
}

/** Where the stacks render. Place inside the app shell (above the tab bar). */
export function NavScreens(): React.JSX.Element {
  const { routes, snapshot } = useNav()
  return (
    <div className="app-body">
      {TAB_ORDER.map((tab) => {
        const stack = snapshot.stacks[tab]
        const tabActive = snapshot.active === tab
        return stack.map((entry, i) => (
          <Screen
            key={entry.key}
            entry={entry}
            tab={tab}
            routes={routes}
            active={tabActive && i === stack.length - 1}
          />
        ))
      })}
    </div>
  )
}

interface ScreenProps {
  entry: Entry
  tab: TabId
  routes: RouteDef[]
  active: boolean
}

/**
 * One scroll container per screen. Hidden screens are `display:none` (cheap: no
 * layout, no paint, lazy images idle); their scrollTop is remembered on the way
 * out and restored before the next paint on the way back in.
 */
const Screen = memo(function Screen({ entry, tab, routes, active }: ScreenProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const saved = useRef(0)
  const match = useMemo(() => matchRoute(entry.path, routes), [entry.path, routes])

  useLayoutEffect(() => {
    const el = ref.current
    if (active && el) el.scrollTop = saved.current
  }, [active])

  const onScroll = (): void => {
    const el = ref.current
    if (active && el) saved.current = el.scrollTop
  }

  const value = useMemo<EntryCtxValue>(
    () => ({ entry, tab, params: match?.params ?? {}, active }),
    [entry, tab, match, active]
  )

  const Component = match?.route.component
  return (
    <div ref={ref} className="screen" hidden={!active} data-screen={entry.key} onScroll={onScroll}>
      <EntryCtx.Provider value={value}>
        {Component ? <Component /> : <div className="empty"><div className="empty-msg">Unknown screen</div></div>}
      </EntryCtx.Provider>
    </div>
  )
})

// ---- hooks -----------------------------------------------------------------

export function useNav(): NavApi {
  const ctx = useContext(NavCtx)
  if (!ctx) throw new Error('useNav must be used within a NavProvider')
  return ctx
}

/** react-router-compatible: `navigate('/path', { state })`, `navigate(-1)`. */
export function useNavigate(): NavigateFn {
  const { push, replace, pop, back } = useNav()
  return useCallback(
    (to, opts) => {
      if (typeof to === 'number') {
        if (to < 0) {
          // -1 from a tab root behaves like system back (hop home).
          if (!pop()) back()
        }
        return
      }
      if (opts?.replace) replace(to, opts.state)
      else push(to, opts?.state)
    },
    [push, replace, pop, back]
  )
}

/** Params captured from the screen's route pattern (already URL-decoded). */
export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  const ctx = useContext(EntryCtx)
  return (ctx?.params ?? {}) as T
}

/** `{ pathname, state }` of the screen this hook is rendered in. */
export function useLocation(): { pathname: string; state: unknown } {
  const ctx = useContext(EntryCtx)
  return { pathname: ctx?.entry.path ?? '/', state: ctx?.entry.state }
}

/** True while this screen is the visible top of the active tab. */
export function useScreenActive(): boolean {
  return useContext(EntryCtx)?.active ?? true
}

/** The tab this screen lives in (for e.g. the tab bar highlight). */
export function useActiveTab(): TabId {
  return useNav().snapshot.active
}
