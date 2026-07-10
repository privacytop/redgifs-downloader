import { SORTS, type SortKey } from '../lib/sort'

interface SortBarProps {
  value: SortKey
  onChange: (key: SortKey) => void
}

/** Horizontal, scrollable sort chips shown above a feed. */
export default function SortBar({ value, onChange }: SortBarProps): React.JSX.Element {
  return (
    <div className="sortbar" role="group" aria-label="Sort">
      {SORTS.map((s) => (
        <button
          key={s.key}
          className={`chip ${value === s.key ? 'on' : ''}`}
          aria-pressed={value === s.key}
          onClick={() => onChange(s.key)}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
