export type ViewMode = 'editorial' | 'grid' | 'feed'

interface ViewToggleProps {
  value: ViewMode
  onChange: (value: ViewMode) => void
}

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'editorial', label: 'Editorial' },
  { id: 'grid', label: 'Grid' },
  { id: 'feed', label: 'Feed' }
]

/** Segmented view-mode toggle: Editorial | Grid | Feed. */
export default function ViewToggle({ value, onChange }: ViewToggleProps): JSX.Element {
  return (
    <div className="seg" role="group" aria-label="View mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={value === m.id ? 'on' : ''}
          aria-pressed={value === m.id}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
