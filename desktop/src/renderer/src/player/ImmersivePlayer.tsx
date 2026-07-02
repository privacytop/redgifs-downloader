import { useCallback, useEffect, useRef, useState } from 'react'
import type { Content } from '@shared/types'
import type { PlaySource } from './PlayerProvider'
import { useNotify } from '../context/notify'
import { formatViews, formatDuration } from '../lib/format'

interface ImmersivePlayerProps {
  source: PlaySource
  onClose: () => void
}

// Ignore wheel/key repeats faster than this while navigating clips.
const STEP_DEBOUNCE_MS = 350
// When within this many of the end, prefetch more via loadMore().
const PREFETCH_WITHIN = 3

/**
 * Full-screen immersive video player. Wheel + Arrow up/down move between clips
 * (debounced); Save downloads the current clip; Esc / the close button dismiss.
 */
export default function ImmersivePlayer({ source, onClose }: ImmersivePlayerProps): JSX.Element {
  const notify = useNotify()

  const [items, setItems] = useState<Content[]>(source.items)
  const [index, setIndex] = useState(
    Math.min(Math.max(source.index, 0), Math.max(source.items.length - 1, 0))
  )
  const [nicheVote, setNicheVote] = useState<'up' | 'down' | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const lastStepRef = useRef(0)
  const loadingRef = useRef(false)
  // Track the latest items for callbacks without stale closures.
  const itemsRef = useRef(items)
  itemsRef.current = items

  const current = items[index]

  // --- pagination: append more when nearing the end ------------------------
  const maybeLoadMore = useCallback(
    async (nextIndex: number): Promise<void> => {
      const list = itemsRef.current
      if (!source.loadMore || loadingRef.current) return
      if (nextIndex < list.length - PREFETCH_WITHIN) return
      loadingRef.current = true
      try {
        const more = await source.loadMore()
        if (more.length) {
          setItems((prev) => {
            const seen = new Set(prev.map((c) => c.id))
            return [...prev, ...more.filter((c) => !seen.has(c.id))]
          })
        }
      } catch {
        /* ignore — playback continues with what we have */
      } finally {
        loadingRef.current = false
      }
    },
    [source]
  )

  // --- stepping between clips (debounced) ----------------------------------
  const step = useCallback(
    (delta: number): void => {
      const now = Date.now()
      if (now - lastStepRef.current < STEP_DEBOUNCE_MS) return
      lastStepRef.current = now
      setIndex((i) => {
        const next = Math.min(Math.max(i + delta, 0), itemsRef.current.length - 1)
        if (next !== i && delta > 0) void maybeLoadMore(next)
        return next
      })
    },
    [maybeLoadMore]
  )

  // Reset the per-clip niche vote when the clip changes.
  useEffect(() => {
    setNicheVote(null)
  }, [index])

  // --- keyboard: Esc closes, arrows step -----------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        step(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        step(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, step])

  // --- wheel: scroll to advance --------------------------------------------
  const onWheel = useCallback(
    (e: React.WheelEvent): void => {
      if (Math.abs(e.deltaY) < 4) return
      step(e.deltaY > 0 ? 1 : -1)
    },
    [step]
  )

  // Clean up the video element on unmount.
  useEffect(() => {
    const v = videoRef.current
    return () => {
      if (v) {
        v.pause()
        v.removeAttribute('src')
        v.load()
      }
    }
  }, [])

  const save = useCallback(async (): Promise<void> => {
    if (!current) return
    try {
      await window.api.downloadContents([current], current.username)
      notify('Saving @' + current.username, 'success')
    } catch (e) {
      notify('Save failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }, [current, notify])

  const vote = useCallback(
    async (state: 'up' | 'down'): Promise<void> => {
      if (!source.nicheId || !current) return
      setNicheVote(state)
      try {
        await window.api.nicheFeedback(source.nicheId, current.id, state)
      } catch {
        /* best-effort feedback */
      }
    },
    [source.nicheId, current]
  )

  if (!current) {
    return (
      <div className="player" onClick={onClose}>
        <div className="player-empty">Nothing to play.</div>
      </div>
    )
  }

  const videoSrc = current.urls.hd || current.urls.sd
  const poster = current.urls.thumbnail || current.urls.poster
  const avatarLetter = (current.username?.[0] ?? '?').toUpperCase()

  return (
    <div className="player" onWheel={onWheel} role="dialog" aria-modal="true" aria-label="Player">
      {/* source chip (top-left) */}
      <div className="player-chip">
        ▸ {source.label} · {index + 1}/{items.length}
      </div>

      {/* close (top-right) */}
      <button className="player-close" type="button" onClick={onClose} aria-label="Close player">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>

      {/* stage */}
      <div className="player-stage">
        <video
          key={current.id}
          ref={videoRef}
          className="player-video"
          src={videoSrc}
          poster={poster}
          controls={false}
          autoPlay
          loop
          playsInline
        />
      </div>

      {/* right action rail */}
      <aside className="player-rail">
        <div className="player-creator">
          <div className="player-avatar" aria-hidden="true">{avatarLetter}</div>
          <div className="player-handle">@{current.username}</div>
        </div>

        <button className="btn btn-ember player-save" type="button" onClick={save}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
          Save
        </button>

        <div className="player-stats">
          <span>{formatViews(current.views)} views</span>
          <span>{formatDuration(current.duration)}</span>
        </div>

        {source.nicheId && (
          <div className="player-niche">
            <div className="player-niche-label">fits this niche?</div>
            <div className="player-niche-btns">
              <button
                type="button"
                className={`btn btn-sm ${nicheVote === 'up' ? 'on' : ''}`}
                onClick={() => vote('up')}
                aria-pressed={nicheVote === 'up'}
                title="Fits"
              >
                ▲
              </button>
              <button
                type="button"
                className={`btn btn-sm ${nicheVote === 'down' ? 'on' : ''}`}
                onClick={() => vote('down')}
                aria-pressed={nicheVote === 'down'}
                title="Doesn't fit"
              >
                ▼
              </button>
            </div>
          </div>
        )}

        {current.tags.length > 0 && (
          <div className="player-tags">
            {current.tags.slice(0, 8).map((t) => (
              <span className="player-tag" key={t}>{t}</span>
            ))}
          </div>
        )}
      </aside>

      {/* bottom hint */}
      <div className="player-hint">scroll ↕ for next</div>
    </div>
  )
}
