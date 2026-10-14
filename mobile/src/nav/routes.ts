import type { ComponentType } from 'react'

/** The five bottom tabs. Each owns an independent navigation stack. */
export type TabId = 'home' | 'discover' | 'library' | 'downloads' | 'you'

export const TAB_ORDER: TabId[] = ['home', 'discover', 'library', 'downloads', 'you']

/** Root path of every tab (the screen at the bottom of its stack). */
export const TAB_ROOTS: Record<TabId, string> = {
  home: '/',
  discover: '/discover',
  library: '/library',
  downloads: '/downloads',
  you: '/you'
}

export interface RouteDef {
  /** `/creator/:username` style pattern. Static segments match exactly. */
  pattern: string
  component: ComponentType
}

export interface RouteMatch {
  route: RouteDef
  params: Record<string, string>
}

/** Tab whose root path equals `path`, if any. */
export function tabForRoot(path: string): TabId | null {
  for (const tab of TAB_ORDER) if (TAB_ROOTS[tab] === path) return tab
  return null
}

function segments(path: string): string[] {
  const clean = path.split(/[?#]/)[0]
  return clean.split('/').filter(Boolean)
}

/**
 * Match a path against the route table. `:name` segments capture (URL-decoded)
 * params; the first matching pattern wins. Returns null for unknown paths.
 */
export function matchRoute(path: string, routes: RouteDef[]): RouteMatch | null {
  const segs = segments(path)
  for (const route of routes) {
    const pat = segments(route.pattern)
    if (pat.length !== segs.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < pat.length; i++) {
      const p = pat[i]
      if (p.startsWith(':')) {
        try {
          params[p.slice(1)] = decodeURIComponent(segs[i])
        } catch {
          params[p.slice(1)] = segs[i]
        }
      } else if (p !== segs[i]) {
        ok = false
        break
      }
    }
    if (ok) return { route, params }
  }
  return null
}
