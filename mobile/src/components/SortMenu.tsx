import { SORTS, type SortKey } from '../lib/sort'

interface SortMenuProps {
  value: SortKey
  onChange: (key: SortKey) => void
  style?: React.CSSProperties
}

/**
 * Compact sort control: a styled native <select> so it uses the OS picker on
 * device (touch-friendly) while matching the app's mono pill look. Drives the
 * same client-side sort as every feed.
 */
export default function SortMenu({ value, onChange, style }: SortMenuProps): React.JSX.Element {
  return (
    <div className="sortmenu" style={style}>
      <select aria-label="Sort" value={value} onChange={(e) => onChange(e.target.value as SortKey)}>
        {SORTS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.key === 'default' ? 'Sort' : s.label}
          </option>
        ))}
      </select>
    </div>
  )
}
