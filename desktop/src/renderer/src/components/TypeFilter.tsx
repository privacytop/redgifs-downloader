import { CONTENT_TYPES, type ContentType } from '../lib/feedOptions'

interface TypeFilterProps {
  value: ContentType
  onChange: (type: ContentType) => void
}

/** Videos / Images segmented toggle (RedGifs `type=g|i`), with proper a11y. */
export default function TypeFilter({ value, onChange }: TypeFilterProps): JSX.Element {
  return (
    <div className="seg" role="group" aria-label="Content type">
      {CONTENT_TYPES.map((t) => (
        <button
          key={t.id}
          type="button"
          className={value === t.id ? 'on' : ''}
          aria-pressed={value === t.id}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
