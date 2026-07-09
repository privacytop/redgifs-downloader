import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Quality, Settings } from '@shared/types'

interface QualityValue {
  quality: Quality
  setQuality: (q: Quality) => void
}

const QualityContext = createContext<QualityValue | null>(null)

/**
 * The single app-wide download quality (HD/SD), seeded from
 * `Settings.preferredQuality` and kept in sync with it: toggling here also
 * persists back to Settings via `updateSettings`, so the choice sticks as
 * the default on next launch too, from wherever it was flipped.
 */
export function QualityProvider({ children }: { children: ReactNode }): JSX.Element {
  const [quality, setQualityState] = useState<Quality>('hd')
  const settingsRef = useRef<Settings | null>(null)

  useEffect(() => {
    window.api
      .getSettings()
      .then((s) => {
        settingsRef.current = s
        setQualityState(s.preferredQuality)
      })
      .catch(() => {
        /* keep the 'hd' default when settings can't be loaded */
      })
  }, [])

  const setQuality = useCallback((q: Quality): void => {
    setQualityState(q)
    const base = settingsRef.current
    if (!base) return
    settingsRef.current = { ...base, preferredQuality: q }
    window.api.updateSettings(settingsRef.current).catch(() => {
      /* local toggle already applied; next toggle will retry the persist */
    })
  }, [])

  return (
    <QualityContext.Provider value={{ quality, setQuality }}>{children}</QualityContext.Provider>
  )
}

/** Returns `{ quality, setQuality }`. Throws outside a QualityProvider. */
export function useQuality(): QualityValue {
  const ctx = useContext(QualityContext)
  if (!ctx) throw new Error('useQuality must be used within a QualityProvider')
  return ctx
}
