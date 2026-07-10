import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Preferences } from '@capacitor/preferences'
import { decodeJwt, isUserToken } from '@redloader/core'
import { AuthCapture } from '../plugins/authCapture'
import { api } from '../lib/api'
import { resetLikes } from '../lib/likes'
import { resetFollows } from '../lib/follows'

const TOKEN_KEY = 'redgifs_user_token'

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

  const apply = (token: string): void => {
    api.setUserToken(token)
    setUsername(usernameFromToken(token))
  }

  useEffect(() => {
    let alive = true
    Preferences.get({ key: TOKEN_KEY })
      .then(({ value }) => {
        if (alive && value && isUserToken(value)) apply(value)
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const login = async (): Promise<void> => {
    const res = await AuthCapture.login()
    if (res.cancelled || !res.token) return
    if (!isUserToken(res.token)) throw new Error('Captured a non-user token')
    apply(res.token)
    await Preferences.set({ key: TOKEN_KEY, value: res.token })
  }

  const logout = async (): Promise<void> => {
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
