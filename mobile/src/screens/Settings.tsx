import { useEffect, useState } from 'react'
import { useSettings } from '../context/settings'
import { useToast } from '../context/toast'
import ScreenHeader from '../components/ScreenHeader'
import { formatSize } from '../lib/format'
import { MediaCache, type MediaCacheStats } from '../plugins/mediaCache'
import {
  MAX_VIDEO_POOL_SIZE,
  MIN_VIDEO_POOL_SIZE,
  normalizeVideoPoolSize
} from '../lib/playerSettings'

/** Streaming, download, playback-memory, and local-cache settings. */
export default function Settings(): React.JSX.Element {
  const {
    downloadQuality,
    streamQuality,
    effectiveStreamQuality,
    lowDataMode,
    tapBehavior,
    videoPoolSize,
    set
  } = useSettings()
  const notify = useToast()
  const [cache, setCache] = useState<MediaCacheStats | null>(null)
  const [clearing, setClearing] = useState(false)
  const [poolDraft, setPoolDraft] = useState(String(videoPoolSize))

  useEffect(() => {
    void MediaCache.stats().then(setCache).catch(() => undefined)
  }, [])

  useEffect(() => setPoolDraft(String(videoPoolSize)), [videoPoolSize])

  const commitVideoPoolSize = (): void => {
    const normalized = normalizeVideoPoolSize(poolDraft)
    set('videoPoolSize', normalized)
    setPoolDraft(String(normalized))
  }

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
          <div className="set-label">Download quality</div>
          <div className="set-hint">Used when saving media to the gallery</div>
        </div>
        <div className="seg" role="group" aria-label="Download quality">
          {(['hd', 'sd'] as const).map((q) => (
            <button
              key={q}
              className={downloadQuality === q ? 'on' : ''}
              onClick={() => set('downloadQuality', q)}
            >
              {q.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="section-label">Player</div>
      <div className="set-row">
        <div>
          <div className="set-label">Streaming quality</div>
          <div className="set-hint">
            {streamQuality === 'auto'
              ? `Auto is currently ${effectiveStreamQuality.toUpperCase()}${lowDataMode ? ' · Android Data Saver' : ''}`
              : 'Forced for all streamed videos'}
          </div>
        </div>
        <div className="seg" role="group" aria-label="Streaming quality">
          {(['auto', 'hd', 'sd'] as const).map((quality) => (
            <button
              key={quality}
              className={streamQuality === quality ? 'on' : ''}
              onClick={() => set('streamQuality', quality)}
            >
              {quality === 'auto' ? 'Auto' : quality.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
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
      <div className="set-row">
        <div>
          <div className="set-label">Videos kept in memory</div>
          <div className="set-hint">
            {MIN_VIDEO_POOL_SIZE}–{MAX_VIDEO_POOL_SIZE} · high values can use substantial RAM and data
          </div>
        </div>
        <input
          className="set-number"
          type="number"
          inputMode="numeric"
          min={MIN_VIDEO_POOL_SIZE}
          max={MAX_VIDEO_POOL_SIZE}
          value={poolDraft}
          aria-label="Videos kept in memory"
          onChange={(event) => setPoolDraft(event.target.value)}
          onBlur={commitVideoPoolSize}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
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
