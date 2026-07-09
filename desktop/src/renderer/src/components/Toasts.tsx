import { useCallback, useEffect, useRef, useState } from 'react'
import type { ToastType } from '@shared/types'
import { IconX } from './icons'

interface Toast {
  id: number
  message: string
  type: ToastType
}

// Errors linger long enough to actually read; everything else is brief.
const DURATION_MS: Record<ToastType, number> = {
  info: 4000,
  success: 3500,
  warning: 6000,
  error: 8000
}
// Never stack more than this many — a burst of download events replaces the
// oldest instead of filling the corner.
const MAX_VISIBLE = 4

export function useToasts(): {
  items: Toast[]
  push: (message: string, type?: ToastType) => void
  dismiss: (id: number) => void
} {
  const [items, setItems] = useState<Toast[]>([])
  const timers = useRef<Map<number, number>>(new Map())

  // Clear pending timers on unmount so a late timeout can't set state.
  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) window.clearTimeout(t)
      map.clear()
    }
  }, [])

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (t !== undefined) window.clearTimeout(t)
    timers.current.delete(id)
    setItems((x) => x.filter((i) => i.id !== id))
  }, [])

  const push = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = Date.now() + Math.random()
      setItems((x) => [...x.slice(-(MAX_VISIBLE - 1)), { id, message, type }])
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), DURATION_MS[type] ?? 4000)
      )
    },
    [dismiss]
  )

  return { items, push, dismiss }
}

/**
 * Toast stack (bottom-right). Each toast auto-dismisses on a per-type timer,
 * can be dismissed with its × button, and the stack is announced politely to
 * screen readers.
 */
export default function Toasts({
  items,
  onDismiss
}: {
  items: Toast[]
  onDismiss?: (id: number) => void
}): JSX.Element {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-msg">{t.message}</span>
          {onDismiss && (
            <button
              type="button"
              className="ibtn"
              aria-label="Dismiss"
              onClick={() => onDismiss(t.id)}
            >
              <IconX />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
