import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Quality } from '@shared/types'

interface QualityValue {
  quality: Quality
  setQuality: (q: Quality) => void
}

const QualityContext = createContext<QualityValue | null>(null)

/**
 * The single app-wide download quality (HD/SD), seeded from
 * `Settings.preferredQuality` and kept in sync with it: toggling here also
 * persists back to Settings, so the choice sticks as the default on next
 * launch too, from wherever it was flipped.
 */
export function QualityProvider({ children }: { children: ReactNode }): JSX.Element {
  const [quality, setQualityState] = useState<Quality>('hd')

  useEffect(() => {
    window.api
      .getSettings()
      .then((s) => setQualityState(s.preferredQuality))
      .catch(() => {
        /* keep the 'hd' default when settings can't be loaded */
      })
  }, [])

  // Persist via read-modify-write of the CURRENT settings — updateSettings is
  // a full-row overwrite in the main process, so writing a snapshot captured
  // at launch would silently revert everything saved on the Settings page
  // since then.
  const setQuality = useCallback((q: Quality): void => {
    setQualityState(q)
    window.api
      .getSettings()
      .then((s) => window.api.updateSettings({ ...s, preferredQuality: q }))
      .catch(() => {
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
