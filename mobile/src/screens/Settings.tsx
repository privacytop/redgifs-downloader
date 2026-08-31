import { useEffect, useState } from 'react'
import { useSettings } from '../context/settings'
import { useToast } from '../context/toast'
import ScreenHeader from '../components/ScreenHeader'
import { formatSize } from '../lib/format'
import { MediaCache, type MediaCacheStats } from '../plugins/mediaCache'

/** App settings — download quality + single-tap behavior (parity with desktop). */
export default function Settings(): React.JSX.Element {
  const { quality, tapBehavior, set } = useSettings()
  const notify = useToast()
  const [cache, setCache] = useState<MediaCacheStats | null>(null)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    void MediaCache.stats().then(setCache).catch(() => undefined)
  }, [])

  const clearThumbnailCache = async (): Promise<void> => {
    setClearing(true)
    try {
      setCache(await MediaCache.clear())
      notify('Thumbnail cache cleared', 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not clear thumbnail cache', 'error')
    } finally {
      setClearing(false)
    }
  }

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

      <div className="section-label">Storage</div>
      <div className="set-row">
        <div>
          <div className="set-label">Thumbnail cache</div>
          <div className="set-hint">
            {cache
              ? `${cache.count} images · ${formatSize(cache.bytes)} of ${formatSize(cache.limitBytes)}`
              : 'Keeps media artwork available between app restarts'}
          </div>
        </div>
        <button
          className="btn btn-sm"
          disabled={clearing || !cache || cache.count === 0}
          onClick={() => void clearThumbnailCache()}
        >
          {clearing ? 'Clearing…' : 'Clear'}
        </button>
      </div>
    </div>
  )
}
