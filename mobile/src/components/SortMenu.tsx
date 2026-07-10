import { useEffect, useRef, useState } from 'react'
import { SORTS, type SortKey } from '../lib/sort'
import { IconChevronDown, IconCheck, IconSort } from './icons'

interface SortMenuProps {
  value: SortKey
  onChange: (key: SortKey) => void
  style?: React.CSSProperties
}

/**
 * Custom sort dropdown — a design-system pill that opens an anchored, animated
 * popover of options (active one in ember with a check). Deliberately NOT a
 * native <select>: no ugly OS picker, and it matches the Midnight Press look.
 * Closes on outside pointer-down, Escape, or selection.
 */
export default function SortMenu({ value, onChange, style }: SortMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = SORTS.find((s) => s.key === value) ?? SORTS[0]
  const label = value === 'default' ? 'Sort' : active.label

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (key: SortKey): void => {
    onChange(key)
    setOpen(false)
  }

  return (
    <div className={`sortmenu ${open ? 'open' : ''}`} style={style} ref={ref}>
      <button
        type="button"
        className="sortmenu-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <IconSort className="sortmenu-lead" />
        <span className="sortmenu-label">{label}</span>
        <IconChevronDown className="sortmenu-chev" />
      </button>

      {open && (
        <div className="sortmenu-pop" role="listbox">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              role="option"
              aria-selected={s.key === value}
              className={`sortmenu-opt ${s.key === value ? 'on' : ''}`}
              onClick={() => pick(s.key)}
            >
              <span>{s.label}</span>
              {s.key === value && <IconCheck />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
