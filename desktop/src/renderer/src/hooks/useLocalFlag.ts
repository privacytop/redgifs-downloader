import { useCallback, useEffect, useState } from 'react'

const EVENT = 'rgd:flag-changed'

/**
 * A boolean UI preference persisted to localStorage under `flag:{key}`,
 * synced live across every mounted consumer via a window event — flipping it
 * in Settings updates open menus/pages immediately, no remount needed.
 */
export function useLocalFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const storageKey = `flag:${key}`

  const read = useCallback((): boolean => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw === '1') return true
      if (raw === '0') return false
    } catch {
      /* storage unavailable — fall through to the default */
    }
    return initial
  }, [storageKey, initial])

  const [value, setValue] = useState<boolean>(read)

  useEffect(() => {
    const onChange = (e: Event): void => {
      if ((e as CustomEvent<{ key: string }>).detail?.key === key) setValue(read())
    }
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
  }, [key, read])

  const set = useCallback(
    (v: boolean): void => {
      setValue(v)
      try {
        localStorage.setItem(storageKey, v ? '1' : '0')
      } catch {
        /* non-fatal */
      }
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { key } }))
    },
    [key, storageKey]
  )

  return [value, set]
}
