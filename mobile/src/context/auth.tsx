import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Preferences } from '@capacitor/preferences'
import { decodeJwt, isUserToken } from '@redloader/core'
import { AuthCapture } from '../plugins/authCapture'
import { SecureTokenStore } from '../plugins/secureTokenStore'
import { api } from '../lib/api'
import { resetLikes } from '../lib/likes'
import { resetFollows } from '../lib/follows'
import { useToast } from './toast'

const TOKEN_KEY = 'redgifs_user_token'
const REFRESH_LEAD_MS = 2 * 60 * 1000
const FAILURE_NOTICE_COOLDOWN_MS = 60 * 1000

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

async function readStoredToken(): Promise<string | null> {
  const secure = await SecureTokenStore.get()
  if (secure.value) return secure.value

  // One-time migration from versions that used plain Capacitor Preferences.
  const legacy = await Preferences.get({ key: TOKEN_KEY })
  if (!legacy.value) return null
  await SecureTokenStore.set({ value: legacy.value })
  await Preferences.remove({ key: TOKEN_KEY })
  return legacy.value
}

async function storeToken(token: string): Promise<void> {
  await SecureTokenStore.set({ value: token })
  await Preferences.remove({ key: TOKEN_KEY })
}

async function removeStoredToken(): Promise<void> {
  await Promise.all([
    SecureTokenStore.remove(),
    Preferences.remove({ key: TOKEN_KEY })
  ])
}

/**
 * App-wide auth. On launch, restores a persisted user token onto the core API
 * client. `login()` drives the proven AuthCapture WebView plugin, captures the
 * Bearer token, sets it on the API + persists it. `logout()` clears both.
 */
export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const notify = useToast()
  const [username, setUsername] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const refreshTimer = useRef<number | null>(null)
  const refreshing = useRef<Promise<boolean> | null>(null)
  const silentRefreshRef = useRef<() => Promise<boolean>>(async () => false)
  const sessionEpoch = useRef(0)
  const lastFailureNotice = useRef(0)

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

  const reportRefreshFailure = useCallback((): void => {
    const now = Date.now()
    if (now - lastFailureNotice.current < FAILURE_NOTICE_COOLDOWN_MS) return
    lastFailureNotice.current = now
    notify('Your RedGifs session could not be renewed. Check your connection or sign in again.', 'warning')
  }, [notify])

  const silentRefresh = useCallback(async (): Promise<boolean> => {
    if (refreshing.current) return refreshing.current
    const epoch = sessionEpoch.current
    const run = (async (): Promise<boolean> => {
      try {
        const previousToken = await readStoredToken()
        const res = await AuthCapture.refresh({ previousToken: previousToken ?? undefined })
        if (epoch !== sessionEpoch.current || res.cancelled) return false
        if (!res.token || !isUserToken(res.token)) {
          reportRefreshFailure()
          return false
        }
        apply(res.token)
        await storeToken(res.token)
        if (epoch !== sessionEpoch.current) return false
        scheduleRefresh(res.token)
        return true
      } catch {
        if (epoch === sessionEpoch.current) reportRefreshFailure()
        return false
      }
    })()
    refreshing.current = run
    try {
      return await run
    } finally {
      refreshing.current = null
    }
  }, [apply, reportRefreshFailure, scheduleRefresh])
  silentRefreshRef.current = silentRefresh

  useEffect(() => {
    let alive = true
    api.setOnAuthExpired(silentRefresh)
    readStoredToken()
      .then((value) => {
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
    const epoch = ++sessionEpoch.current
    await AuthCapture.cancel()
    const res = await AuthCapture.login()
    if (epoch !== sessionEpoch.current || res.cancelled || !res.token) return
    if (!isUserToken(res.token)) throw new Error('Captured a non-user token')
    apply(res.token)
    await storeToken(res.token)
    scheduleRefresh(res.token)
  }

  const logout = async (): Promise<void> => {
    sessionEpoch.current += 1
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current)
      refreshTimer.current = null
    }
    api.clearUserToken()
    setUsername(null)
    resetLikes()
    resetFollows()
    await Promise.allSettled([AuthCapture.logout(), removeStoredToken()])
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
