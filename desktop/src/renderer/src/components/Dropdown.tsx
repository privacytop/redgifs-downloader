import { useCallback, useEffect, useRef, useState } from 'react'

export interface DropdownOption {
  id: string
  label: string
}

interface DropdownProps {
  value: string
  onChange: (id: string) => void
  options: readonly DropdownOption[]
  ariaLabel: string
}

/**
 * Custom select: a `.select`-styled trigger opening a `.menu-panel` popover —
 * replaces native <select> so dropdowns match the app instead of Chromium's
 * defaults. Keyboard: Enter/Space/↓ open, ↑/↓ rove, Enter picks, Esc closes
 * and restores focus; outside clicks close.
 */
export default function Dropdown({ value, onChange, options, ariaLabel }: DropdownProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.id === value)

  const close = useCallback((refocus: boolean): void => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

  // Outside clicks close (capture, so rows still receive their own click).
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false)
    }
    document.addEventListener('mousedown', onDoc, true)
    return () => document.removeEventListener('mousedown', onDoc, true)
  }, [open, close])

  // Focus the selected row when the panel opens — deps on `open` alone:
  // callers pass inline option arrays, and re-running on every parent render
  // would yank focus back mid-navigation.
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const target =
      panel?.querySelector<HTMLButtonElement>('.menu-row.active') ??
      panel?.querySelector<HTMLButtonElement>('.menu-row')
    target?.focus()
  }, [open])

  const onPanelKey = (e: React.KeyboardEvent): void => {
    const rows = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('.menu-row') ?? [])]
    const at = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      rows[Math.min(at + 1, rows.length - 1)]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      rows[Math.max(at - 1, 0)]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    } else if (e.key === 'Tab') {
      // Refocus the trigger before the default Tab runs, so focus moves to the
      // next control after the dropdown instead of falling back to <body>.
      close(true)
    }
  }

  return (
    <div className="dd" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="select"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {selected?.label ?? value}
      </button>
      {open && (
        <div
          ref={panelRef}
          className="menu-panel"
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={onPanelKey}
        >
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              className={`menu-row ${o.id === value ? 'active' : ''}`}
              onClick={() => {
                onChange(o.id)
                close(true)
              }}
            >
              {o.label}
              {o.id === value && (
                <span className="dd-check" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
