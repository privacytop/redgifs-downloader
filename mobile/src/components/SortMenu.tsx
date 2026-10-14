import { useEffect, useRef, useState } from 'react'
import type { SortOption } from '../lib/sort'
import { findSort } from '../lib/sort'
import { IconChevronDown, IconCheck, IconSort } from './icons'

interface SortMenuProps {
  options: SortOption[]
  value: string
  onChange: (key: string) => void
  style?: React.CSSProperties
}

/**
 * Custom sort dropdown — a design-system pill that opens an anchored, animated
 * popover of options (active one in ember with a check). Deliberately NOT a
 * native <select>: no ugly OS picker, and it matches the Midnight Press look.
 * The option list is per feed (server orders vs. local sorts), see lib/sort.
 * Closes on outside pointer-down, Escape, or selection.
 */
export default function SortMenu({ options, value, onChange, style }: SortMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = findSort(options, value)
  const label = active.key === 'default' ? 'Sort' : active.label

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

  const pick = (key: string): void => {
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
          {options.map((s) => (
            <button
              key={s.key}
              type="button"
              role="option"
              aria-selected={s.key === active.key}
              className={`sortmenu-opt ${s.key === active.key ? 'on' : ''}`}
              onClick={() => pick(s.key)}
            >
              <span>{s.label}</span>
              {s.key === active.key && <IconCheck />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
