import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Content } from '@redloader/core'
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
  IconPlay,
  IconPlus,
  IconSound,
  IconUser,
  IconX
} from '../components/icons'

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

/**
 * Full-screen swipe/wheel player: drag or scroll-wheel up/down to move between
 * clips, single-tap does what Settings says (pause or mute), double-tap likes.
 * Like state is persisted across clips via the shared likes cache, and the rail
 * carries like / mute / follow / save / add-to-collection.
 */
export default function Player({ source, onClose, onSave, onCollect }: PlayerProps): React.JSX.Element {
  const notify = useToast()
  const navigate = useNavigate()
  const { tapBehavior } = useSettings()
  const { authenticated } = useAuth()

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
  const [following, setFollowing] = useState(false)
  const [collected, setCollected] = useState(false)
  const [progress, setProgress] = useState(0)
  const [drag, setDrag] = useState(0)
  const [heartBurst, setHeartBurst] = useState(false)

  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const itemsRef = useRef(items)
  itemsRef.current = items
  const indexRef = useRef(index)
  indexRef.current = index
  const loadingRef = useRef(false)
  const wantPlayingRef = useRef(true)
  const startY = useRef<number | null>(null)
  const wheelAccRef = useRef(0)
  const stepLockRef = useRef(false)
  const lastTapRef = useRef(0)

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
      if (stepLockRef.current) return
      const next = Math.min(Math.max(indexRef.current + delta, 0), itemsRef.current.length - 1)
      if (next === indexRef.current) return
      wantPlayingRef.current = true
      setIndex(next)
      if (delta > 0) void maybeLoadMore(next)
      stepLockRef.current = true
      window.setTimeout(() => {
        stepLockRef.current = false
        wheelAccRef.current = 0
      }, STEP_LOCK_MS)
    },
    [maybeLoadMore]
  )

  // Per-clip reset + start playback; like reflects the shared cache.
  useEffect(() => {
    setProgress(0)
    setLiked(current ? isLiked(current.id) : false)
    if (current) setFollowing(isFollowing(current.username))
    // Collection membership lives in sqlite; reflect it (async) per clip.
    setCollected(false)
    if (current) {
      const id = current.id
      void storage.gifCollectionIds(id).then((ids) => {
        if (itemsRef.current[indexRef.current]?.id === id) setCollected(ids.length > 0)
      })
    }
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

  // Load the shared caches once, then reflect them; listen for changes so a
  // like/follow made anywhere (or on revisiting a clip) shows here.
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
  }, [currentVideo])

  const toggleLike = useCallback(async (): Promise<void> => {
    if (!current) return
    const next = !liked
    try {
      await setLike(current.id, next)
    } catch (e) {
      notify(
        (authenticated ? 'Like failed: ' : 'Sign in to like — ') +
          (e instanceof Error ? e.message : String(e)),
        'error'
      )
    }
  }, [current, liked, notify, authenticated])

  const likeFromDoubleTap = useCallback((): void => {
    if (!current || liked) {
      setHeartBurst(true)
      window.setTimeout(() => setHeartBurst(false), 600)
      return
    }
    setHeartBurst(true)
    window.setTimeout(() => setHeartBurst(false), 600)
    void toggleLike()
  }, [current, liked, toggleLike])

  const toggleFollow = useCallback(async (): Promise<void> => {
    if (!current) return
    const next = !following
    try {
      await setFollow(current.username, next)
    } catch (e) {
      notify(
        (authenticated ? 'Follow failed: ' : 'Sign in to follow — ') +
          (e instanceof Error ? e.message : String(e)),
        'error'
      )
    }
  }, [current, following, notify, authenticated])

  const onVideoTap = useCallback((): void => {
    const now = Date.now()
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0
      likeFromDoubleTap()
    } else {
      lastTapRef.current = now
      window.setTimeout(() => {
        // If no second tap arrived, this was a single tap.
        if (lastTapRef.current !== 0 && Date.now() - lastTapRef.current >= DOUBLE_TAP_MS - 20) {
          lastTapRef.current = 0
          if (tapBehavior === 'mute') setMuted((m) => !m)
          else togglePlay()
        }
      }, DOUBLE_TAP_MS)
    }
  }, [likeFromDoubleTap, tapBehavior, togglePlay])

  const goCreator = (): void => {
    if (!current) return
    onClose()
    navigate(`/creator/${encodeURIComponent(current.username)}`)
  }

  // --- gestures -------------------------------------------------------------
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

  if (!current) {
    return (
      <div className="player" onClick={onClose}>
        <div className="empty" style={{ height: '100%', justifyContent: 'center' }}>
          <div className="empty-msg">Nothing to play</div>
        </div>
      </div>
    )
  }

  const first = Math.max(0, index - 1)
  const slides = items.slice(first, Math.min(items.length, index + 2))

  return (
    <div
      className="player"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onWheel={onWheel}
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
                transform: `translateY(calc(${offset}% + ${drag}px))`,
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
                onClick={isCurrent ? onVideoTap : undefined}
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

      <div className="player-top">
        <span className="player-chip">
          {source.label} · {index + 1}/{items.length}
        </span>
        <button className="player-close" onClick={onClose} aria-label="Close">
          <IconX />
        </button>
      </div>

      <div className="player-rail">
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

      <div className="player-info">
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
      </div>

      <div className="player-scrub">
        <i style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </div>
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
