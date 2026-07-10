import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import type { ToastType } from '@redloader/core'

interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastCtx {
  notify: (message: string, type?: ToastType) => void
}

const Ctx = createContext<ToastCtx | null>(null)

const DURATION: Record<ToastType, number> = { info: 3500, success: 3000, warning: 5000, error: 6000 }

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [items, setItems] = useState<Toast[]>([])
  const seq = useRef(0)

  const notify = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++seq.current
    setItems((x) => [...x.slice(-3), { id, message, type }])
    window.setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), DURATION[type] ?? 3500)
  }, [])

  return (
    <Ctx.Provider value={{ notify }}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): (message: string, type?: ToastType) => void {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx.notify
}
