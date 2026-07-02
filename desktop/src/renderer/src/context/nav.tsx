import { createContext, useCallback, useContext, useState } from 'react'
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

interface NavContextValue {
  route: Route
  navigate: (r: Route) => void
  back: () => void
  canBack: boolean
}

const DEFAULT_ROUTE: Route = { name: 'for-you' }

// Top-level sidebar destinations. Navigating to one RESETS the stack (no back
// button); only detail views (creator/collection/niche/tag/search) push onto it.
const BASE_NAMES = new Set([
  'for-you', 'discover', 'following', 'niches', 'collections', 'likes',
  'downloads', 'history', 'settings', 'account'
])

const NavContext = createContext<NavContextValue | null>(null)

/** Holds a route stack. Base routes reset it; detail routes push; `back` pops. */
export function NavProvider({ children }: { children: ReactNode }): JSX.Element {
  const [stack, setStack] = useState<Route[]>([DEFAULT_ROUTE])

  const navigate = useCallback((r: Route): void => {
    setStack((s) => (BASE_NAMES.has(r.name) ? [r] : [...s, r]))
  }, [])

  const back = useCallback((): void => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
  }, [])

  const route = stack[stack.length - 1]
  const canBack = stack.length > 1

  return (
    <NavContext.Provider value={{ route, navigate, back, canBack }}>
      {children}
    </NavContext.Provider>
  )
}

export function useNav(): NavContextValue {
  const ctx = useContext(NavContext)
  if (!ctx) throw new Error('useNav must be used within a NavProvider')
  return ctx
}
