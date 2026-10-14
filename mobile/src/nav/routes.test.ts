import { describe, expect, it } from 'vitest'
import { matchRoute, tabForRoot, type RouteDef } from './routes'

const Noop = (): null => null
const ROUTES: RouteDef[] = [
  { pattern: '/', component: Noop },
  { pattern: '/creator/:username', component: Noop },
  { pattern: '/search/:query', component: Noop },
  { pattern: '/settings', component: Noop }
]

describe('matchRoute', () => {
  it('matches static and param routes, decoding params once', () => {
    expect(matchRoute('/', ROUTES)?.route.pattern).toBe('/')
    expect(matchRoute('/settings', ROUTES)?.route.pattern).toBe('/settings')
    const m = matchRoute('/creator/some%20one', ROUTES)
    expect(m?.route.pattern).toBe('/creator/:username')
    expect(m?.params.username).toBe('some one')
  })

  it('ignores query/hash and rejects unknown or deeper paths', () => {
    expect(matchRoute('/search/cats?x=1#y', ROUTES)?.params.query).toBe('cats')
    expect(matchRoute('/creator/a/b', ROUTES)).toBeNull()
    expect(matchRoute('/nope', ROUTES)).toBeNull()
  })

  it('maps tab roots', () => {
    expect(tabForRoot('/library')).toBe('library')
    expect(tabForRoot('/creator/x')).toBeNull()
  })
})
