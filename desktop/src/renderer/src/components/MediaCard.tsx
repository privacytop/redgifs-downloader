import { useEffect, useRef, useState } from 'react'
import type { Content } from '@shared/types'
import { useNav } from '../context/nav'
import { captureFrame, useThumbnailMode } from '../hooks/useThumbnailMode'
import { formatDuration, formatViews } from '../lib/format'

interface MediaCardProps {
  content: Content
  onOpen: (content: Content) => void
  onDownload: (content: Content) => void
  /** Optional editorial badge (e.g. rank `01`, a niche). */
  badge?: string
}

/**
 * Portrait 9:16 media tile for a piece of `Content`.
 * Shows the thumbnail poster; on hover or keyboard focus, lazily plays a
 * muted-looping preview (prefers a `silent` clip, falls back to `sd`). An
 * invisible full-card button opens the player; the top-right button downloads.
 * Video only mounts/plays while hovered/focused — cheap when idle.
 */
export default function MediaCard({ content, onOpen, onDownload, badge }: MediaCardProps): JSX.Element {
  const { navigate } = useNav()
  const [hover, setHover] = useState(false)
  const [thumbMode] = useThumbnailMode()
  const videoRef = useRef<HTMLVideoElement>(null)

  const urls = content.urls
  const thumbnail = urls.thumbnail || urls.poster
  const previewSrc = urls.silent || urls.sd || urls.hd

  // Poster actually shown: falls back to the API thumbnail until (or unless) a
  // captured video frame resolves.
  const [captured, setCaptured] = useState<string | null>(null)
  const poster = captured || thumbnail

  // For `middle`/`random`, capture a frame on mount and use it as the poster.
  useEffect(() => {
    if (thumbMode !== 'middle' && thumbMode !== 'random') {
      setCaptured(null)
      return
    }
    if (!previewSrc) return
    let alive = true
    captureFrame(previewSrc, thumbMode)
      .then((data) => {
        if (alive && data) setCaptured(data)
      })
      .catch(() => {
        /* keep thumbnail on failure */
      })
    return () => {
      alive = false
    }
  }, [thumbMode, previewSrc])

  // `auto`: probe the thumbnail's luminance on a SEPARATE cross-origin image (so
  // the visible poster never needs crossorigin and can't break on a missing CORS
  // header). If it reads near-black, swap in a mid-clip frame. Best-effort: any
  // CORS/taint/decode failure just keeps the thumbnail.
  useEffect(() => {
    if (thumbMode !== 'auto' || captured || !thumbnail || !previewSrc) return
    let alive = true
    const probe = new Image()
    probe.crossOrigin = 'anonymous'
    probe.onload = (): void => {
      if (!alive) return
      try {
        const sw = 32
        const sh = Math.max(1, Math.round((probe.naturalHeight / probe.naturalWidth) * sw)) || 32
        const canvas = document.createElement('canvas')
        canvas.width = sw
        canvas.height = sh
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(probe, 0, 0, sw, sh)
        const { data } = ctx.getImageData(0, 0, sw, sh)
        let sum = 0
        const px = data.length / 4
        for (let i = 0; i < data.length; i += 4) {
          sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
        }
        if (sum / px < 18) {
          captureFrame(previewSrc, 'middle').then((frame) => {
            if (alive && frame) setCaptured(frame)
          }).catch(() => {})
        }
      } catch {
        /* tainted / read failed — keep the thumbnail */
      }
    }
    probe.src = thumbnail
    return () => {
      alive = false
    }
  }, [thumbMode, thumbnail, previewSrc, captured])

  function enter(): void {
    setHover(true)
  }
  function leave(): void {
    setHover(false)
    const v = videoRef.current
    if (v) {
      v.pause()
      // reset so re-hover restarts cleanly and the element frees decode work
      v.removeAttribute('src')
      v.load()
    }
  }

  return (
    <div
      className="pcard"
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={(e) => {
        // focus-within: only stop the preview when focus leaves the whole card,
        // not when it hops between the card's own buttons.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) leave()
      }}
    >
      {poster && (
        <img
          className="pcard-poster"
          src={poster}
          alt={content.title || content.username}
          loading="lazy"
        />
      )}

      {hover && previewSrc && (
        <video
          ref={videoRef}
          className="pcard-video"
          src={previewSrc}
          poster={poster}
          muted
          loop
          playsInline
          autoPlay
          preload="none"
        />
      )}

      {badge && <span className="pcard-badge">{badge}</span>}

      <div className="pcard-scrim" />

      <button
        type="button"
        className="pcard-open"
        aria-label={'Play ' + (content.title || '@' + content.username)}
        onClick={() => onOpen(content)}
      />

      <button
        type="button"
        className="pcard-dl"
        title="Download"
        aria-label={`Download ${content.username ? '@' + content.username : 'clip'}`}
        onClick={() => onDownload(content)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
      </button>

      <div className="pcard-meta">
        <button
          type="button"
          className="pcard-user"
          title={`View @${content.username}`}
          onClick={() => navigate({ name: 'creator', username: content.username })}
        >
          @{content.username}
        </button>
        <span className="pcard-views">
          {formatViews(content.views)} views
          {Number.isFinite(content.duration) && content.duration > 0
            ? ' · ' + formatDuration(content.duration)
            : ''}
        </span>
      </div>
    </div>
  )
}
