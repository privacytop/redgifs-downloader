import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  title: string
  /** Body copy explaining what is about to happen. */
  body: string
  /** Confirm button label (e.g. "Cancel download"). */
  confirmLabel: string
  /** Style the confirm action as destructive. */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Modal confirmation for destructive/irreversible actions. Esc or a backdrop
 * click cancels; focus starts on the (safe) Keep button so Enter never
 * destroys anything by accident.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel
}: ConfirmDialogProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Focus once on mount only — callers pass inline onCancel arrows, and a
  // combined effect would re-steal focus on every parent render.
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    }
    // Capture phase so an open player behind the dialog doesn't also close.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div className="overlay" onClick={onCancel}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-title">{title}</div>
        <div className="dialog-body">{body}</div>
        <div className="dialog-actions">
          <button type="button" className="btn" ref={cancelRef} onClick={onCancel}>
            Keep
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-ember'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
