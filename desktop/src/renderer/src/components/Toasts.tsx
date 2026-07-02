import { useCallback, useState } from 'react'
import type { ToastType } from '@shared/types'

interface Toast { id: number; message: string; type: ToastType }

export function useToasts() {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, message, type }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 5000)
  }, [])
  return { items, push }
}

export default function Toasts({ items }: { items: Toast[] }): JSX.Element {
  return (
    <div className="toasts">
      {items.map((t) => <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>)}
    </div>
  )
}
