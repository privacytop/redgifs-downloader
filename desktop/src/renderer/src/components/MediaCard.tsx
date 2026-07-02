import { useRef, useState } from 'react'
import type { Content } from '@shared/types'
import { useNav } from '../context/nav'

interface MediaCardProps {
  content: Content
  onOpen: (content: Content) => void
  onDownload: (content: Content) => void
  /** Optional editorial badge (e.g. rank `01`, a niche). */
  badge?: string
}

/** Compact number formatter for view counts: 1234 → 1.2K, 3400000 → 3.4M. */
function formatViews(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return String(n)
}

/**
 * Portrait 9:16 media tile for a piece of `Content`.
 * Shows the thumbnail poster; on hover, lazily plays a muted-looping preview
 * (prefers a `silent` clip, falls back to `sd`). Clicking opens; the top-right
 * button downloads. Video only mounts/plays while hovered — cheap when idle.
 */
export default function MediaCard({ content, onOpen, onDownload, badge }: MediaCardProps): JSX.Element {
  const { navigate } = useNav()
  const [hover, setHover] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const urls = content.urls
  const poster = urls.thumbnail || urls.poster
  // `silent` may be added to ContentUrls later (owned by another agent); read it
  // defensively without assuming the field exists on the shared type.
  const previewSrc =
    (urls as Record<string, string | undefined>).silent || urls.sd || urls.hd

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
      onClick={() => onOpen(content)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(content)
        }
      }}
    >
      {poster && (
        <img className="pcard-poster" src={poster} alt={content.title || content.username} loading="lazy" />
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
        className="pcard-dl"
        title="Download"
        aria-label={`Download ${content.username ? '@' + content.username : 'clip'}`}
        onClick={(e) => {
          e.stopPropagation()
          onDownload(content)
        }}
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
          onClick={(e) => {
            e.stopPropagation()
            navigate({ name: 'creator', username: content.username })
          }}
        >
          @{content.username}
        </button>
        <span className="pcard-views">{formatViews(content.views)} views</span>
      </div>
    </div>
  )
}
