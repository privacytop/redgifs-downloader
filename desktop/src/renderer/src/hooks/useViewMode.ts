import { useCallback, useState } from 'react'
import type { ViewMode } from '../components/ViewToggle'

const VALID: ViewMode[] = ['editorial', 'grid', 'feed']

/**
 * View-mode state persisted to localStorage under `viewmode:{key}`.
 * Falls back to `initial` (default 'editorial') when nothing is stored or
 * storage is unavailable.
 */
export function useViewMode(
  key: string,
  initial: ViewMode = 'editorial'
): [ViewMode, (m: ViewMode) => void] {
  const storageKey = `viewmode:${key}`

  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved && (VALID as string[]).includes(saved)) return saved as ViewMode
    } catch {
      /* ignore — storage may be unavailable */
    }
    return initial
  })

  const set = useCallback(
    (m: ViewMode): void => {
      setMode(m)
      try {
        localStorage.setItem(storageKey, m)
      } catch {
        /* ignore */
      }
    },
    [storageKey]
  )

  return [mode, set]
}
