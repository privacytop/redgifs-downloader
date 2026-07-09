import { useQuality } from '../context/quality'

const OPTIONS = ['hd', 'sd'] as const

/** Segmented HD/SD download-quality toggle, synced app-wide via QualityProvider. */
export default function QualityToggle(): JSX.Element {
  const { quality, setQuality } = useQuality()
  return (
    <div className="seg" role="group" aria-label="Download quality">
      {OPTIONS.map((q) => (
        <button
          key={q}
          type="button"
          className={quality === q ? 'on' : ''}
          aria-pressed={quality === q}
          onClick={() => setQuality(q)}
        >
          {q.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
