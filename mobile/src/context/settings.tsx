import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Preferences } from '@capacitor/preferences'
import type { Quality } from '@redloader/core'
import {
  DEFAULT_VIDEO_POOL_SIZE,
  normalizeVideoPoolSize
} from '../lib/playerSettings'
import { DataMode } from '../plugins/dataMode'
import {
  normalizeQuality,
  normalizeStreamQuality,
  resolveStreamQuality,
  type StreamQuality
} from '../lib/qualitySettings'

/** Single-tap on a playing clip: pause it, or toggle mute. */
export type TapBehavior = 'pause' | 'mute'
export type { StreamQuality } from '../lib/qualitySettings'

export interface Settings {
  downloadQuality: Quality
  streamQuality: StreamQuality
  tapBehavior: TapBehavior
  videoPoolSize: number
}

const DEFAULTS: Settings = {
  downloadQuality: 'hd',
  streamQuality: 'auto',
  tapBehavior: 'pause',
  videoPoolSize: DEFAULT_VIDEO_POOL_SIZE
}
const KEY = 'settings'

interface SettingsCtx extends Settings {
  ready: boolean
  lowDataMode: boolean
  effectiveStreamQuality: Quality
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void
}

const Ctx = createContext<SettingsCtx | null>(null)

/** App preferences persisted via Capacitor Preferences (survives restarts). */
export function SettingsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [ready, setReady] = useState(false)
  // Be conservative until Android reports its Data Saver state.
  const [lowDataMode, setLowDataMode] = useState(true)

  useEffect(() => {
    let alive = true
    Preferences.get({ key: KEY })
      .then(({ value }) => {
        if (alive && value) {
          try {
            const restored = JSON.parse(value) as Partial<Settings> & { quality?: Quality }
            setSettings({
              downloadQuality: normalizeQuality(
                restored.downloadQuality ?? restored.quality,
                DEFAULTS.downloadQuality
              ),
              streamQuality: normalizeStreamQuality(restored.streamQuality),
              tapBehavior: restored.tapBehavior ?? DEFAULTS.tapBehavior,
              videoPoolSize: normalizeVideoPoolSize(restored.videoPoolSize)
            })
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

  useEffect(() => {
    let live = true
    let remove: (() => Promise<void>) | undefined
    const apply = ({ lowData }: { lowData: boolean }): void => {
      if (live) setLowDataMode(lowData)
    }
    void DataMode.get().then(apply).catch(() => undefined)
    void DataMode.addListener('change', apply).then((handle) => {
      if (!live) void handle.remove()
      else remove = handle.remove
    }).catch(() => undefined)
    return () => {
      live = false
      if (remove) void remove()
    }
  }, [])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    setSettings((prev) => {
      const next = {
        ...prev,
        [key]: key === 'videoPoolSize' ? normalizeVideoPoolSize(value) : value
      }
      void Preferences.set({ key: KEY, value: JSON.stringify(next) })
      return next
    })
  }

  const effectiveStreamQuality: Quality = resolveStreamQuality(settings.streamQuality, lowDataMode)

  return (
    <Ctx.Provider value={{ ...settings, ready, lowDataMode, effectiveStreamQuality, set }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider')
  return ctx
}
