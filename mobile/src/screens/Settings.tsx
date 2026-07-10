import { useSettings } from '../context/settings'
import ScreenHeader from '../components/ScreenHeader'

/** App settings — download quality + single-tap behavior (parity with desktop). */
export default function Settings(): React.JSX.Element {
  const { quality, tapBehavior, set } = useSettings()

  return (
    <div className="page">
      <ScreenHeader title="Settings" back />

      <div className="section-label">Downloads</div>
      <div className="set-row">
        <div>
          <div className="set-label">Default quality</div>
          <div className="set-hint">Used for every save</div>
        </div>
        <div className="seg" role="group" aria-label="Default quality">
          {(['hd', 'sd'] as const).map((q) => (
            <button key={q} className={quality === q ? 'on' : ''} onClick={() => set('quality', q)}>
              {q.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="section-label">Player</div>
      <div className="set-row">
        <div>
          <div className="set-label">Single tap</div>
          <div className="set-hint">What tapping the video does · double-tap always likes</div>
        </div>
        <div className="seg" role="group" aria-label="Single tap behavior">
          <button className={tapBehavior === 'pause' ? 'on' : ''} onClick={() => set('tapBehavior', 'pause')}>
            Pause
          </button>
          <button className={tapBehavior === 'mute' ? 'on' : ''} onClick={() => set('tapBehavior', 'mute')}>
            Mute
          </button>
        </div>
      </div>
    </div>
  )
}
