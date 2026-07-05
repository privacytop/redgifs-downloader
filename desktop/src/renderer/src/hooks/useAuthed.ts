import { useEffect, useState } from 'react'

/**
 * Reactive auth state. Resolves the current status on mount and then updates
 * live on `evt:auth:changed` (login/logout), so a page the user is already
 * sitting on refetches the moment they sign in — no manual navigation needed.
 * Returns `null` while the initial status is still loading.
 */
export function useAuthed(): boolean | null {
  const [authed, setAuthed] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    window.api
      .authStatus()
      .then((s) => {
        if (alive) setAuthed(s.authenticated)
      })
      .catch(() => {
        if (alive) setAuthed(false)
      })
    const off = window.api.on('evt:auth:changed', (s) => setAuthed(s.authenticated))
    return () => {
      alive = false
      off()
    }
  }, [])
  return authed
}
