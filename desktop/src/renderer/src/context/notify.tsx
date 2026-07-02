import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { ToastType } from '@shared/types'

export type Notify = (message: string, type?: ToastType) => void

const NotifyContext = createContext<Notify | null>(null)

/**
 * Provides a `push(message, type?)` notifier to the tree. App owns the
 * `useToasts` instance and passes its `push` in as `value`.
 */
export function NotifyProvider({
  value,
  children
}: {
  value: Notify
  children: ReactNode
}): JSX.Element {
  return <NotifyContext.Provider value={value}>{children}</NotifyContext.Provider>
}

/** Returns `push(message, type?)`. Throws if used outside a NotifyProvider. */
export function useNotify(): Notify {
  const ctx = useContext(NotifyContext)
  if (!ctx) throw new Error('useNotify must be used within a NotifyProvider')
  return ctx
}
