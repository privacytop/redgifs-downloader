import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Content } from '@redloader/core'
import type { PlaySource } from './PlayerProvider'
import { formatViews, formatDuration } from '../lib/format'
import { useToast } from '../context/toast'
import { api } from '../lib/api'
import {
  IconBookmark,
  IconDownload,
  IconHeart,
  IconMuted,
  IconPlay,
  IconSound,
  IconX
} from '../components/icons'

interface PlayerProps {
  source: PlaySource
  onClose: () => void
  /** Save the current clip (phase 4 wires the download queue). */
  onSave?: (c: Content) => void
  /** Open the add-to-collection sheet (phase 3). */
  onCollect?: (c: Content) => void
}

// Vertical drag past this fraction of the screen commits a clip change.
const SWIPE_COMMIT = 0.18
const PREFETCH_WITHIN = 3
const MUTE_KEY = 'player:muted'

/**
 * Full-screen swipe player: drag up/down to move between clips (TikTok-style),
 * tap to pause, side rail for like/save/collection, a mute toggle and a bottom
 * scrubber. The current clip and its neighbours are mounted so the next clip is
 * already buffering when you swipe onto it.
 */
export default function Player({ source, onClose, onSave, onCollect }: PlayerProps): React.JSX.Element {
  const notify = useToast()
  const navigate = useNavigate()

  const [items, setItems] = useState<Content[]>(source.items)
  const [index, setIndex] = useState(
    Math.min(Math.max(source.index, 0), Math.max(source.items.length - 1, 0))
  )
  const [playing, setPlaying] = useState(true)
  const [muted, setMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [liked, setLiked] = useState(false)
  const [progress, setProgress] = useState(0)
  const [drag, setDrag] = useState(0)

  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const itemsRef = useRef(items)
  itemsRef.current = items
  const indexRef = useRef(index)
  indexRef.current = index
  const loadingRef = useRef(false)
  const wantPlayingRef = useRef(true)
  const startY = useRef<number | null>(null)

  const current = items[index]

  const currentVideo = useCallback(
    (): HTMLVideoElement | undefined => videoRefs.current.get(itemsRef.current[indexRef.current]?.id ?? ''),
    []
  )

  const maybeLoadMore = useCallback(
    async (nextIndex: number): Promise<void> => {
      if (loadingRef.current || !source.loadMore) return
      if (nextIndex < itemsRef.current.length - PREFETCH_WITHIN) return
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
        /* keep playing what we have */
      } finally {
        loadingRef.current = false
      }
    },
    [source]
  )

  const step = useCallback(
    (delta: number): void => {
      const next = Math.min(Math.max(indexRef.current + delta, 0), itemsRef.current.length - 1)
      if (next === indexRef.current) return
      wantPlayingRef.current = true
      setIndex(next)
      if (delta > 0) void maybeLoadMore(next)
    },
    [maybeLoadMore]
  )

  // Reset per-clip state + pause the others so exactly one clip plays.
  useEffect(() => {
    setProgress(0)
    setLiked(false)
    for (const [id, v] of videoRefs.current) {
      if (id !== current?.id) {
        v.pause()
        if (v.currentTime !== 0) v.currentTime = 0
      }
    }
    const v = currentVideo()
    if (v && wantPlayingRef.current) {
      v.muted = muted
      v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  useEffect(() => {
    const v = currentVideo()
    if (v) v.muted = muted
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
    } catch {
      /* non-fatal */
    }
  }, [muted, currentVideo])

  const togglePlay = useCallback((): void => {
    const v = currentVideo()
    if (!v) return
    if (v.paused) {
      wantPlayingRef.current = true
      void v.play().catch(() => setPlaying(false))
    } else {
      wantPlayingRef.current = false
      v.pause()
    }
  }, [currentVideo])

  const toggleLike = useCallback(async (): Promise<void> => {
    if (!current) return
    const next = !liked
    setLiked(next)
    try {
      if (next) await api.likeGif(current.id)
      else await api.unlikeGif(current.id)
    } catch (e) {
      setLiked(!next)
      notify('Sign in to like — ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }, [current, liked, notify])

  const goCreator = (): void => {
    if (!current) return
    onClose()
    navigate(`/creator/${encodeURIComponent(current.username)}`)
  }

  // --- touch swipe ----------------------------------------------------------
  const onTouchStart = (e: React.TouchEvent): void => {
    startY.current = e.touches[0].clientY
  }
  const onTouchMove = (e: React.TouchEvent): void => {
    if (startY.current === null) return
    setDrag(e.touches[0].clientY - startY.current)
  }
  const onTouchEnd = (): void => {
    if (startY.current === null) return
    const h = window.innerHeight
    if (drag < -h * SWIPE_COMMIT) step(1)
    else if (drag > h * SWIPE_COMMIT) step(-1)
    startY.current = null
    setDrag(0)
  }

  if (!current) {
    return (
      <div className="player" onClick={onClose}>
        <div className="empty" style={{ height: '100%', justifyContent: 'center' }}>
          <div className="empty-msg">Nothing to play</div>
        </div>
      </div>
    )
  }

  // Mount current ± 1 so the next clip is already buffering.
  const first = Math.max(0, index - 1)
  const slides = items.slice(first, Math.min(items.length, index + 2))

  return (
    <div
      className="player"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="player-deck">
        {slides.map((c, s) => {
          const i = first + s
          const isCurrent = i === index
          const offset = (i - index) * 100
          return (
            <div
              key={c.id}
              className="player-slide"
              style={{
                transform: `translateY(calc(${offset}% + ${isCurrent || i === index + 1 || i === index - 1 ? drag : 0}px))`,
                transition: startY.current !== null ? 'none' : undefined
              }}
            >
              <video
                ref={(el) => {
                  if (el) videoRefs.current.set(c.id, el)
                  else videoRefs.current.delete(c.id)
                }}
                className="player-video"
                src={c.urls.hd || c.urls.sd}
                poster={c.urls.thumbnail || c.urls.poster}
                loop
                playsInline
                muted={!isCurrent || muted}
                preload="auto"
                autoPlay={isCurrent}
                onClick={isCurrent ? togglePlay : undefined}
                onTimeUpdate={
                  isCurrent
                    ? (e) => {
                        const v = e.currentTarget
                        if (v.duration) setProgress(v.currentTime / v.duration)
                      }
                    : undefined
                }
                onPlay={isCurrent ? () => setPlaying(true) : undefined}
                onPause={isCurrent ? () => setPlaying(false) : undefined}
              />
            </div>
          )
        })}
      </div>

      <div className="player-scrim" />

      {!playing && (
        <div className="player-paused" aria-hidden="true">
          <IconPlay />
        </div>
      )}

      <div className="player-top">
        <span className="player-chip">
          {source.label} · {index + 1}/{items.length}
        </span>
        <button className="player-close" onClick={onClose} aria-label="Close">
          <IconX />
        </button>
      </div>

      <div className="player-rail">
        <div style={{ textAlign: 'center' }}>
          <button
            className={`player-rail-btn ${liked ? 'on' : ''}`}
            onClick={() => void toggleLike()}
            aria-label="Like"
          >
            <IconHeart />
          </button>
          <div className="player-rail-label">Like</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <button className="player-rail-btn" onClick={() => setMuted((m) => !m)} aria-label="Mute">
            {muted ? <IconMuted /> : <IconSound />}
          </button>
          <div className="player-rail-label">{muted ? 'Muted' : 'Sound'}</div>
        </div>
        {onSave && (
          <div style={{ textAlign: 'center' }}>
            <button className="player-rail-btn" onClick={() => onSave(current)} aria-label="Save">
              <IconDownload />
            </button>
            <div className="player-rail-label">Save</div>
          </div>
        )}
        {onCollect && (
          <div style={{ textAlign: 'center' }}>
            <button className="player-rail-btn" onClick={() => onCollect(current)} aria-label="Collect">
              <IconBookmark />
            </button>
            <div className="player-rail-label">Collect</div>
          </div>
        )}
      </div>

      <div className="player-info">
        <button className="player-handle" onClick={goCreator}>@{current.username}</button>
        <div className="player-stats">
          {formatViews(current.views)} views · {formatDuration(current.duration)}
        </div>
      </div>

      <div className="player-scrub">
        <i style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </div>
  )
}
