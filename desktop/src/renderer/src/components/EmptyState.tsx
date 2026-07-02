import type { ReactNode } from 'react'

interface EmptyStateProps {
  /** Primary mono message. */
  message: string
  /** Optional secondary sub-line. */
  hint?: string
  /**
   * Optional small icon. Constrained to ≤40px by `.empty-icon` regardless of
   * the intrinsic SVG size — never let an unconstrained icon blow up the layout.
   */
  icon?: ReactNode
  /** Optional action node (e.g. a button). */
  action?: ReactNode
}

/** Centered mono empty-state message with an optional small icon. */
export default function EmptyState({ message, hint, icon, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-msg">{message}</div>
      {hint && <div className="empty-sub">{hint}</div>}
      {action}
    </div>
  )
}
