import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Preferences } from '@capacitor/preferences'
import type { Quality } from '@redloader/core'

/** Single-tap on a playing clip: pause it, or toggle mute. */
export type TapBehavior = 'pause' | 'mute'

export interface Settings {
  quality: Quality
  tapBehavior: TapBehavior
}

const DEFAULTS: Settings = { quality: 'hd', tapBehavior: 'pause' }
const KEY = 'settings'

interface SettingsCtx extends Settings {
  ready: boolean
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void
}

const Ctx = createContext<SettingsCtx | null>(null)

/** App preferences persisted via Capacitor Preferences (survives restarts). */
export function SettingsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    Preferences.get({ key: KEY })
      .then(({ value }) => {
        if (alive && value) {
          try {
            setSettings({ ...DEFAULTS, ...(JSON.parse(value) as Partial<Settings>) })
          } catch {
            /* keep defaults */
          }
        }
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value }
      void Preferences.set({ key: KEY, value: JSON.stringify(next) })
      return next
    })
  }

  return <Ctx.Provider value={{ ...settings, ready, set }}>{children}</Ctx.Provider>
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider')
  return ctx
}
