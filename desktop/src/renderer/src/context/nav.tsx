import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export type Route =
  | {
      name:
        | 'for-you'
        | 'discover'
        | 'following'
        | 'niches'
        | 'collections'
        | 'likes'
        | 'library'
        | 'downloads'
        | 'history'
        | 'settings'
        | 'account'
    }
  | { name: 'creator'; username: string }
  | { name: 'collection'; id: string; title: string }
  | { name: 'niche'; id: string; title: string }
  | { name: 'tag'; tag: string }
  | { name: 'search'; query: string }

/** How the current route was reached — drives scroll reset vs. restore. */
export type NavAction = 'reset' | 'push' | 'pop' | 'forward'

interface NavContextValue {
  route: Route
  navigate: (r: Route) => void
  back: () => void
  forward: () => void
  canBack: boolean
  canForward: boolean
  /** Depth of the current entry in the stack (scroll-memory key). */
  depth: number
  /** How the current route was arrived at. */
  action: NavAction
}

const DEFAULT_ROUTE: Route = { name: 'for-you' }

// Top-level sidebar destinations. Navigating to one RESETS the stack (no back
// button); only detail views (creator/collection/niche/tag/search) push onto it.
const BASE_NAMES = new Set([
  'for-you', 'discover', 'following', 'niches', 'collections', 'likes',
  'library', 'downloads', 'history', 'settings', 'account'
])

interface Hist {
  stack: Route[]
  fwd: Route[]
}

const NavContext = createContext<NavContextValue | null>(null)

/**
 * Holds a route stack plus a forward stack (Notion-style ‹/› history). Base
 * routes reset both; detail routes push (clearing forward); `back` pops onto
 * the forward stack; `forward` replays it. `action`/`depth` let the shell
 * reset scroll on new pages and restore it when walking history.
 *
 * Both stacks live in ONE state value and every updater is pure — no setState
 * inside another updater, so StrictMode's double-invoke can't corrupt history.
 */
export function NavProvider({ children }: { children: ReactNode }): JSX.Element {
  const [hist, setHist] = useState<Hist>({ stack: [DEFAULT_ROUTE], fwd: [] })
  const actionRef = useRef<NavAction>('reset')

  const navigate = useCallback((r: Route): void => {
    actionRef.current = BASE_NAMES.has(r.name) ? 'reset' : 'push'
    setHist((h) => {
      if (BASE_NAMES.has(r.name)) {
        // Re-selecting the current base page is a no-op (keeps scroll).
        const top = h.stack[h.stack.length - 1]
        if (h.stack.length === 1 && JSON.stringify(top) === JSON.stringify(r)) return h
        return { stack: [r], fwd: [] }
      }
      return { stack: [...h.stack, r], fwd: [] }
    })
  }, [])

  const back = useCallback((): void => {
    actionRef.current = 'pop'
    setHist((h) =>
      h.stack.length > 1
        ? { stack: h.stack.slice(0, -1), fwd: [...h.fwd, h.stack[h.stack.length - 1]] }
        : h
    )
  }, [])

  const forward = useCallback((): void => {
    actionRef.current = 'forward'
    setHist((h) =>
      h.fwd.length
        ? { stack: [...h.stack, h.fwd[h.fwd.length - 1]], fwd: h.fwd.slice(0, -1) }
        : h
    )
  }, [])

  const route = hist.stack[hist.stack.length - 1]

  return (
    <NavContext.Provider
      value={{
        route,
        navigate,
        back,
        forward,
        canBack: hist.stack.length > 1,
        canForward: hist.fwd.length > 0,
        depth: hist.stack.length,
        action: actionRef.current
      }}
    >
      {children}
    </NavContext.Provider>
  )
}

export function useNav(): NavContextValue {
  const ctx = useContext(NavContext)
  if (!ctx) throw new Error('useNav must be used within a NavProvider')
  return ctx
}
