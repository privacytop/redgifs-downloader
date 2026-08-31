import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Preferences } from '@capacitor/preferences'
import { decodeJwt, isUserToken } from '@redloader/core'
import { AuthCapture } from '../plugins/authCapture'
import { api } from '../lib/api'
import { resetLikes } from '../lib/likes'
import { resetFollows } from '../lib/follows'

const TOKEN_KEY = 'redgifs_user_token'
const REFRESH_LEAD_MS = 2 * 60 * 1000

interface AuthState {
  authenticated: boolean
  username: string | null
  ready: boolean
  login: () => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

function usernameFromToken(token: string): string | null {
  const u = decodeJwt(token)?.preferred_username
  return typeof u === 'string' && u ? u : null
}

/**
 * App-wide auth. On launch, restores a persisted user token onto the core API
 * client. `login()` drives the proven AuthCapture WebView plugin, captures the
 * Bearer token, sets it on the API + persists it. `logout()` clears both.
 */
export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [username, setUsername] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const refreshTimer = useRef<number | null>(null)
  const refreshing = useRef<Promise<boolean> | null>(null)
  const silentRefreshRef = useRef<() => Promise<boolean>>(async () => false)

  const apply = useCallback((token: string): void => {
    api.setUserToken(token)
    setUsername(usernameFromToken(token))
  }, [])

  const scheduleRefresh = useCallback((token: string): void => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current)
    const exp = decodeJwt(token)?.exp
    if (typeof exp !== 'number') return
    const delay = Math.max(5000, exp * 1000 - Date.now() - REFRESH_LEAD_MS)
    refreshTimer.current = window.setTimeout(() => void silentRefreshRef.current(), delay)
  }, [])

  const silentRefresh = useCallback(async (): Promise<boolean> => {
    if (refreshing.current) return refreshing.current
    const run = (async (): Promise<boolean> => {
      try {
        const { value: previousToken } = await Preferences.get({ key: TOKEN_KEY })
        const res = await AuthCapture.refresh({ previousToken: previousToken ?? undefined })
        if (res.cancelled || !res.token || !isUserToken(res.token)) return false
        apply(res.token)
        await Preferences.set({ key: TOKEN_KEY, value: res.token })
        scheduleRefresh(res.token)
        return true
      } catch {
        return false
      }
    })()
    refreshing.current = run
    try {
      return await run
    } finally {
      refreshing.current = null
    }
  }, [apply, scheduleRefresh])
  silentRefreshRef.current = silentRefresh

  useEffect(() => {
    let alive = true
    api.setOnAuthExpired(silentRefresh)
    Preferences.get({ key: TOKEN_KEY })
      .then(({ value }) => {
        if (!alive || !value || !isUserToken(value)) return
        apply(value)
        const exp = decodeJwt(value)?.exp
        if (typeof exp === 'number' && Date.now() >= exp * 1000 - 60000) void silentRefresh()
        else scheduleRefresh(value)
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current)
    }
  }, [apply, scheduleRefresh, silentRefresh])

  const login = async (): Promise<void> => {
    const res = await AuthCapture.login()
    if (res.cancelled || !res.token) return
    if (!isUserToken(res.token)) throw new Error('Captured a non-user token')
    apply(res.token)
    await Preferences.set({ key: TOKEN_KEY, value: res.token })
    scheduleRefresh(res.token)
  }

  const logout = async (): Promise<void> => {
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current)
      refreshTimer.current = null
    }
    api.clearUserToken()
    setUsername(null)
    resetLikes()
    resetFollows()
    await Preferences.remove({ key: TOKEN_KEY })
  }

  return (
    <Ctx.Provider value={{ authenticated: username !== null, username, ready, login, logout }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
