import { memo, useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { pickUrl, type Content, type Quality } from '@redloader/core'
import { useNavigate } from '../nav'
import type { PlaySource } from './PlayerProvider'
import { formatViews, formatDuration } from '../lib/format'
import { useToast } from '../context/toast'
import { useSettings } from '../context/settings'
import { useAuth } from '../context/auth'
import { isLiked, loadLikedIds, setLike, LIKE_EVENT, type LikeChange } from '../lib/likes'
import { FOLLOW_EVENT, isFollowing, loadFollows, setFollow, type FollowChange } from '../lib/follows'
import { COLLECT_EVENT, type CollectChange } from '../lib/collect'
import { storage } from '../lib/storage'
import {
  IconBookmark,
  IconCheck,
  IconDownload,
  IconHeart,
  IconMuted,
  IconPictureInPicture,
  IconPlay,
  IconPlus,
  IconSound,
  IconUser,
  IconX
} from '../components/icons'
import { PictureInPicture } from '../plugins/pictureInPicture'
import { CachedVideo } from '../components/CachedMedia'
import { updateVideoPool } from './videoPool'

interface PlayerProps {
  source: PlaySource
  onClose: () => void
  onSave?: (c: Content) => void
  onCollect?: (c: Content) => void
}

const SWIPE_COMMIT = 0.18
const WHEEL_STEP_PX = 60
const STEP_LOCK_MS = 320
const PREFETCH_WITHIN = 3
const MUTE_KEY = 'player:muted'
const DOUBLE_TAP_MS = 280
const SPEED_KEY = 'player:speed'
const CONTROL_HIDE_MS = 3000
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

type VideoRefs = MutableRefObject<Map<string, HTMLVideoElement>>

// Collection membership per gif for the session, so swiping back to a clip
// doesn't flash "Collect" before the sqlite answer arrives.
const collectedCache = new Map<string, boolean>()

/**
 * Full-screen swipe/wheel player: drag or scroll-wheel up/down to move between
 * clips, single-tap does what Settings says (pause or mute), double-tap likes.
 *
 * Render-cost design: playback progress lives in <PlayerScrub> (it subscribes
 * to the current <video> directly), and the drag offset is written straight to
 * the deck element's transform — so neither re-renders the Player or the
 * resident video slides. Slides are memoised with stable callbacks.
 */
export default function Player({ source, onClose, onSave, onCollect }: PlayerProps): React.JSX.Element {
  const notify = useToast()
  const navigate = useNavigate()
  const { tapBehavior, effectiveStreamQuality, videoPoolSize } = useSettings()
  const { authenticated } = useAuth()

  const [items, setItems] = useState<Content[]>(source.items)
  const [index, setIndex] = useState(
    Math.min(Math.max(source.index, 0), Math.max(source.items.length - 1, 0))
  )
  const [residentVideoIds, setResidentVideoIds] = useState<string[]>(() =>
    updateVideoPool(source.items.map((item) => item.id), source.index, [], videoPoolSize)
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
  const [following, setFollowing] = useState(false)
  const [collected, setCollected] = useState(false)
  const [heartBurst, setHeartBurst] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [pipMode, setPipMode] = useState(false)
  const [speed, setSpeed] = useState<number>(() => {
    const saved = Number(localStorage.getItem(SPEED_KEY) ?? 1)
    return SPEEDS.includes(saved as (typeof SPEEDS)[number]) ? saved : 1
  })

  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const refCallbacks = useRef<Map<string, (el: HTMLVideoElement | null) => void>>(new Map())
  const deckRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const indexRef = useRef(index)
  indexRef.current = index
  const speedRef = useRef(speed)
  speedRef.current = speed
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const loadingRef = useRef(false)
  const wantPlayingRef = useRef(true)
  const startY = useRef<number | null>(null)
  const dragRef = useRef(0)
  const wheelAccRef = useRef(0)
  const stepLockRef = useRef(false)
  const lastTapRef = useRef(0)
  const tapTimerRef = useRef<number | null>(null)
  const controlsTimerRef = useRef<number | null>(null)
  const heartTimerRef = useRef<number | null>(null)
  const stepTimerRef = useRef<number | null>(null)

  const current = items[index]
  const currentId = current?.id ?? ''

  // One stable ref callback per clip id, so memoised slides never re-render
  // just because the parent did.
  const registerRef = useCallback((id: string) => {
    let cb = refCallbacks.current.get(id)
    if (!cb) {
      cb = (el: HTMLVideoElement | null): void => {
        if (el) videoRefs.current.set(id, el)
        else videoRefs.current.delete(id)
      }
      refCallbacks.current.set(id, cb)
    }
    return cb
  }, [])

  useEffect(() => {
    setResidentVideoIds((resident) =>
      updateVideoPool(items.map((item) => item.id), index, resident, videoPoolSize)
    )
  }, [index, items, videoPoolSize])

  // Every timer is owned by a ref and cleared on unmount.
  useEffect(
    () => () => {
      for (const t of [tapTimerRef, controlsTimerRef, heartTimerRef, stepTimerRef]) {
        if (t.current !== null) window.clearTimeout(t.current)
      }
    },
    []
  )

  const currentVideo = useCallback(
    (): HTMLVideoElement | undefined => videoRefs.current.get(itemsRef.current[indexRef.current]?.id ?? ''),
    []
  )

  const showControls = useCallback((): void => {
    setControlsVisible(true)
    if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current)
    if (wantPlayingRef.current) {
      controlsTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false)
        setSpeedOpen(false)
      }, CONTROL_HIDE_MS)
    }
  }, [])

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
      if (stepLockRef.current) return
      const next = Math.min(Math.max(indexRef.current + delta, 0), itemsRef.current.length - 1)
      if (next === indexRef.current) return
      wantPlayingRef.current = true
      setIndex(next)
      if (delta > 0) void maybeLoadMore(next)
      stepLockRef.current = true
      if (stepTimerRef.current !== null) window.clearTimeout(stepTimerRef.current)
      stepTimerRef.current = window.setTimeout(() => {
        stepLockRef.current = false
        wheelAccRef.current = 0
      }, STEP_LOCK_MS)
    },
    [maybeLoadMore]
  )

  // Per-clip reset + start playback; like/follow/collect reflect shared caches.
  useEffect(() => {
    if (tapTimerRef.current !== null) {
      window.clearTimeout(tapTimerRef.current)
      tapTimerRef.current = null
      lastTapRef.current = 0
    }
    setLiked(current ? isLiked(current.id) : false)
    if (current) setFollowing(isFollowing(current.username))
    if (current) {
      const id = current.id
      const known = collectedCache.get(id)
      setCollected(known ?? false)
      if (known === undefined) {
        void storage
          .gifCollectionIds(id)
          .then((ids) => {
            collectedCache.set(id, ids.length > 0)
            if (itemsRef.current[indexRef.current]?.id === id) setCollected(ids.length > 0)
          })
          .catch(() => undefined)
      }
    }
    for (const [id, v] of videoRefs.current) {
      if (id !== current?.id) v.pause()
    }
    const v = currentVideo()
    if (v && wantPlayingRef.current) {
      v.muted = mutedRef.current
      v.playbackRate = speedRef.current
      v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId])

  useEffect(() => {
    for (const video of videoRefs.current.values()) video.playbackRate = speed
    localStorage.setItem(SPEED_KEY, String(speed))
  }, [speed])

  useEffect(() => {
    if (playing) showControls()
    else {
      if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current)
      setControlsVisible(true)
    }
  }, [playing, currentId, showControls])

  // PiP: register the mode listener ONCE; only the aspect hint follows the clip.
  useEffect(() => {
    let disposed = false
    let remove: (() => Promise<void>) | undefined
    void PictureInPicture.addListener('pipModeChanged', ({ active }) => setPipMode(active)).then((handle) => {
      if (disposed) void handle.remove()
      else remove = handle.remove
    })
    return () => {
      disposed = true
      if (remove) void remove()
      void PictureInPicture.setActive({ active: false }).catch(() => undefined)
    }
  }, [])
  useEffect(() => {
    const dims = { width: current?.width || 9, height: current?.height || 16 }
    void PictureInPicture.setActive({ active: true, ...dims }).catch(() => undefined)
  }, [current?.width, current?.height])

  // Load the shared caches once, then reflect them; listen for changes so a
  // like/follow/collect made anywhere (or on revisiting a clip) shows here.
  useEffect(() => {
    void loadLikedIds().then(() => {
      const c = itemsRef.current[indexRef.current]
      if (c) setLiked(isLiked(c.id))
    })
    void loadFollows().then(() => {
      const c = itemsRef.current[indexRef.current]
      if (c) setFollowing(isFollowing(c.username))
    })
    const onLike = (e: Event): void => {
      const d = (e as CustomEvent<LikeChange>).detail
      const c = itemsRef.current[indexRef.current]
      if (c && c.id === d.gifId) setLiked(d.liked)
    }
    const onFollow = (e: Event): void => {
      const d = (e as CustomEvent<FollowChange>).detail
      const c = itemsRef.current[indexRef.current]
      if (c && c.username.toLowerCase() === d.username.toLowerCase()) setFollowing(d.following)
    }
    const onCollect = (e: Event): void => {
      const d = (e as CustomEvent<CollectChange>).detail
      collectedCache.set(d.gifId, d.collected)
      const c = itemsRef.current[indexRef.current]
      if (c && c.id === d.gifId) setCollected(d.collected)
    }
    window.addEventListener(LIKE_EVENT, onLike)
    window.addEventListener(FOLLOW_EVENT, onFollow)
    window.addEventListener(COLLECT_EVENT, onCollect)
    return () => {
      window.removeEventListener(LIKE_EVENT, onLike)
      window.removeEventListener(FOLLOW_EVENT, onFollow)
      window.removeEventListener(COLLECT_EVENT, onCollect)
    }
  }, [])

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
    showControls()
  }, [currentVideo, showControls])

  const toggleLike = useCallback(async (): Promise<void> => {
    const c = itemsRef.current[indexRef.current]
    if (!c) return
    const next = !isLiked(c.id)
    try {
      await setLike(c.id, next)
    } catch (e) {
      notify(
        (authenticated ? 'Like failed: ' : 'Sign in to like — ') +
          (e instanceof Error ? e.message : String(e)),
        'error'
      )
    }
  }, [notify, authenticated])

  const burstHeart = useCallback((): void => {
    setHeartBurst(true)
    if (heartTimerRef.current !== null) window.clearTimeout(heartTimerRef.current)
    heartTimerRef.current = window.setTimeout(() => setHeartBurst(false), 600)
  }, [])

  const likeFromDoubleTap = useCallback((): void => {
    burstHeart()
    const c = itemsRef.current[indexRef.current]
    if (c && !isLiked(c.id)) void toggleLike()
  }, [burstHeart, toggleLike])

  const toggleFollow = useCallback(async (): Promise<void> => {
    const c = itemsRef.current[indexRef.current]
    if (!c) return
    const next = !isFollowing(c.username)
    try {
      await setFollow(c.username, next)
    } catch (e) {
      notify(
        (authenticated ? 'Follow failed: ' : 'Sign in to follow — ') +
          (e instanceof Error ? e.message : String(e)),
        'error'
      )
    }
  }, [notify, authenticated])

  const tapBehaviorRef = useRef(tapBehavior)
  tapBehaviorRef.current = tapBehavior
  const onVideoTap = useCallback((): void => {
    showControls()
    const now = Date.now()
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0
      if (tapTimerRef.current !== null) window.clearTimeout(tapTimerRef.current)
      tapTimerRef.current = null
      likeFromDoubleTap()
      return
    }
    lastTapRef.current = now
    if (tapTimerRef.current !== null) window.clearTimeout(tapTimerRef.current)
    tapTimerRef.current = window.setTimeout(() => {
      // No second tap arrived: this was a single tap (the timer is cleared on
      // clip change, so it can never act on the next clip).
      tapTimerRef.current = null
      lastTapRef.current = 0
      if (tapBehaviorRef.current === 'mute') setMuted((m) => !m)
      else togglePlay()
    }, DOUBLE_TAP_MS)
  }, [likeFromDoubleTap, showControls, togglePlay])

  const enterPip = async (): Promise<void> => {
    if (!current) return
    setSpeedOpen(false)
    try {
      const result = await PictureInPicture.enter({ width: current.width, height: current.height })
      if (result.active) setPipMode(true)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Picture-in-picture is unavailable', 'warning')
    }
  }

  const goCreator = (): void => {
    if (!current) return
    onClose()
    navigate(`/creator/${encodeURIComponent(current.username)}`)
  }

  const goTag = (tag: string): void => {
    onClose()
    navigate(`/tag/${encodeURIComponent(tag)}`)
  }

  // --- gestures -------------------------------------------------------------
  // The drag offset is applied to the deck wrapper directly (no state, no
  // re-render per touchmove). Slides animate their own offset with the same
  // duration/easing, so on release the two transitions add up to one smooth
  // motion from the finger position to the next clip.
  const setDeck = (px: number, animate: boolean): void => {
    const el = deckRef.current
    if (!el) return
    el.style.transition = animate ? 'transform var(--t-med) var(--ease)' : 'none'
    el.style.transform = px ? `translateY(${px}px)` : ''
  }
  const onTouchStart = (e: React.TouchEvent): void => {
    showControls()
    startY.current = e.touches[0].clientY
    dragRef.current = 0
  }
  const onTouchMove = (e: React.TouchEvent): void => {
    if (startY.current === null) return
    dragRef.current = e.touches[0].clientY - startY.current
    setDeck(dragRef.current, false)
  }
  const onTouchEnd = (): void => {
    if (startY.current === null) return
    const h = window.innerHeight
    const drag = dragRef.current
    startY.current = null
    dragRef.current = 0
    setDeck(0, true)
    if (drag < -h * SWIPE_COMMIT) step(1)
    else if (drag > h * SWIPE_COMMIT) step(-1)
  }
  const onWheel = (e: React.WheelEvent): void => {
    if (stepLockRef.current) return
    wheelAccRef.current += e.deltaY
    if (Math.abs(wheelAccRef.current) >= WHEEL_STEP_PX) {
      const dir = wheelAccRef.current > 0 ? 1 : -1
      wheelAccRef.current = 0
      step(dir)
    }
  }

  // Keyboard for desktop-style testing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowDown') step(1)
      else if (e.key === 'ArrowUp') step(-1)
      else if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, step, togglePlay])

  const onPlay = useCallback(() => setPlaying(true), [])
  const onPause = useCallback(() => setPlaying(false), [])

  if (!current) {
    return (
      <div className="player" onClick={onClose}>
        <div className="empty" style={{ height: '100%', justifyContent: 'center' }}>
          <div className="empty-msg">Nothing to play</div>
        </div>
      </div>
    )
  }

  const residentSet = new Set(residentVideoIds)

  return (
    <div
      className={`player ${pipMode ? 'pip' : ''} ${controlsVisible || !playing ? '' : 'controls-hidden'}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onWheel={onWheel}
    >
      <div className="player-deck" ref={deckRef}>
        {items.map((c, i) =>
          residentSet.has(c.id) ? (
            <Slide
              key={c.id}
              content={c}
              offset={(i - index) * 100}
              isCurrent={i === index}
              muted={muted}
              quality={effectiveStreamQuality}
              registerRef={registerRef}
              onTap={onVideoTap}
              onPlay={onPlay}
              onPause={onPause}
            />
          ) : null
        )}
      </div>

      <div className="player-scrim player-chrome" />

      {heartBurst && (
        <div className="player-heart-burst" aria-hidden="true">
          <IconHeart style={{ fill: 'var(--ember)', stroke: 'var(--ember)' }} />
        </div>
      )}

      {!playing && (
        <div className="player-paused" aria-hidden="true">
          <IconPlay />
        </div>
      )}

      <div className="player-top player-chrome">
        <span className="player-chip">
          {source.label} · {index + 1}/{items.length}
        </span>
        <div className="player-top-actions">
          <div className="player-speed-wrap">
            <button
              className="player-tool"
              onClick={() => {
                showControls()
                setSpeedOpen((v) => !v)
              }}
              aria-label="Playback speed"
              aria-expanded={speedOpen}
            >
              {speed}×
            </button>
            {speedOpen && (
              <div className="player-speed-menu">
                {SPEEDS.map((value) => (
                  <button
                    key={value}
                    className={value === speed ? 'on' : ''}
                    onClick={() => {
                      setSpeed(value)
                      setSpeedOpen(false)
                      showControls()
                    }}
                  >
                    {value}×
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="player-tool" onClick={() => void enterPip()} aria-label="Picture in picture">
            <IconPictureInPicture />
          </button>
          <button className="player-close" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
      </div>

      <div className="player-rail player-chrome">
        <RailBtn label="Like" on={liked} onClick={() => void toggleLike()}>
          <IconHeart style={liked ? { fill: 'var(--ember)', stroke: 'var(--ember)' } : undefined} />
        </RailBtn>
        <RailBtn label={muted ? 'Muted' : 'Sound'} onClick={() => setMuted((m) => !m)}>
          {muted ? <IconMuted /> : <IconSound />}
        </RailBtn>
        {onCollect && (
          <RailBtn label={collected ? 'Collected' : 'Collect'} on={collected} onClick={() => onCollect(current)}>
            <IconBookmark style={collected ? { fill: 'var(--ember)', stroke: 'var(--ember)' } : undefined} />
          </RailBtn>
        )}
        {onSave && (
          <RailBtn label="Save" onClick={() => onSave(current)}>
            <IconDownload />
          </RailBtn>
        )}
      </div>

      <div className="player-info player-chrome">
        <div className="player-id">
          <button
            className={`player-follow ${following ? 'on' : ''}`}
            onClick={() => void toggleFollow()}
            aria-label={following ? 'Following — tap to unfollow' : 'Follow'}
          >
            <IconUser />
            <span className="player-follow-badge">{following ? <IconCheck /> : <IconPlus />}</span>
          </button>
          <div className="player-id-text">
            <button className="player-handle" onClick={goCreator}>@{current.username}</button>
            <div className="player-stats">
              {formatViews(current.views)} views · {formatDuration(current.duration)}
            </div>
          </div>
        </div>
        {current.tags && current.tags.length > 0 && (
          <div className="player-tags">
            {current.tags.slice(0, 6).map((t) => (
              <button key={t} className="player-tag" onClick={() => goTag(t)}>
                #{t}
              </button>
            ))}
          </div>
        )}
      </div>

      <PlayerScrub
        videoRefs={videoRefs}
        currentId={currentId}
        fallbackDuration={current.duration ?? 0}
        speedRef={speedRef}
        onInteract={showControls}
      />
    </div>
  )
}

interface SlideProps {
  content: Content
  offset: number
  isCurrent: boolean
  muted: boolean
  quality: Quality
  registerRef: (id: string) => (el: HTMLVideoElement | null) => void
  onTap: () => void
  onPlay: () => void
  onPause: () => void
}

/** One resident clip. Memoised: only its own props (offset, current, mute) re-render it. */
const Slide = memo(function Slide({
  content: c,
  offset,
  isCurrent,
  muted,
  quality,
  registerRef,
  onTap,
  onPlay,
  onPause
}: SlideProps): React.JSX.Element {
  return (
    <div className="player-slide" style={{ transform: `translateY(${offset}%)` }}>
      <CachedVideo
        ref={registerRef(c.id)}
        className="player-video"
        src={pickUrl(c, quality)}
        posterKey={`media:${c.id}`}
        posterUrl={c.urls.thumbnail || c.urls.poster}
        loop
        playsInline
        muted={!isCurrent || muted}
        preload="auto"
        autoPlay={isCurrent}
        onClick={isCurrent ? onTap : undefined}
        onPlay={isCurrent ? onPlay : undefined}
        onPause={isCurrent ? onPause : undefined}
      />
    </div>
  )
})

interface ScrubProps {
  videoRefs: VideoRefs
  currentId: string
  fallbackDuration: number
  speedRef: MutableRefObject<number>
  onInteract: () => void
}

/**
 * Time readout + seek bar. Subscribes to the current <video>'s timeupdate /
 * metadata events itself, so the ~4 updates a second re-render only this
 * small component — never the deck of videos above it.
 */
function PlayerScrub({ videoRefs, currentId, fallbackDuration, speedRef, onInteract }: ScrubProps): React.JSX.Element {
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(fallbackDuration)

  useEffect(() => {
    setProgress(0)
    setDuration(fallbackDuration)
    const v = videoRefs.current.get(currentId)
    if (!v) return
    const sync = (): void => {
      const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : fallbackDuration
      setDuration(d)
      setProgress(d > 0 ? Math.min(1, v.currentTime / d) : 0)
    }
    const meta = (): void => {
      v.playbackRate = speedRef.current
      sync()
    }
    sync()
    v.addEventListener('timeupdate', sync)
    v.addEventListener('loadedmetadata', meta)
    v.addEventListener('durationchange', sync)
    return () => {
      v.removeEventListener('timeupdate', sync)
      v.removeEventListener('loadedmetadata', meta)
      v.removeEventListener('durationchange', sync)
    }
  }, [currentId, fallbackDuration, videoRefs, speedRef])

  const seekTo = (fraction: number): void => {
    const v = videoRefs.current.get(currentId)
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return
    const next = Math.min(1, Math.max(0, fraction))
    v.currentTime = next * v.duration
    setProgress(next)
  }

  return (
    <>
      <div className="player-timebar player-chrome">
        <span>{formatDuration(progress * duration)}</span>
        <span>−{formatDuration(Math.max(0, duration * (1 - progress)))}</span>
      </div>
      <div
        className="player-scrub player-chrome"
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <input
          type="range"
          min="0"
          max="1000"
          step="1"
          value={Math.round(progress * 1000)}
          aria-label="Playback position"
          style={{ '--progress': `${Math.round(progress * 100)}%` } as React.CSSProperties}
          onChange={(e) => seekTo(Number(e.currentTarget.value) / 1000)}
          onPointerDown={onInteract}
        />
      </div>
    </>
  )
}

function RailBtn({
  label,
  on,
  onClick,
  children
}: {
  label: string
  on?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div style={{ textAlign: 'center' }}>
      <button className={`player-rail-btn ${on ? 'on' : ''}`} onClick={onClick} aria-label={label}>
        {children}
      </button>
      <div className="player-rail-label">{label}</div>
    </div>
  )
}
