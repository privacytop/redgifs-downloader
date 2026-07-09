import { useCallback, useEffect, useRef, useState } from 'react'
import type { Content } from '@shared/types'
import type { PlaySource } from './PlayerProvider'
import { useNotify } from '../context/notify'
import { useNav } from '../context/nav'
import { useBlockedTags } from '../context/blockedTags'
import { useQuality } from '../context/quality'
import { formatViews, formatDuration } from '../lib/format'
import { readCache, writeCache } from '../lib/cache'
import { FOLLOW_EVENT, FOLLOWS_RELOADED_EVENT, isFollowing, loadFollows, setFollow } from '../lib/follows'
import type { FollowChange } from '../lib/follows'
import CollectionMenu from './CollectionMenu'
import { IconChevronDown, IconDownload, IconUsers, IconX } from '../components/icons'
import type { Quality } from '@shared/types'

interface ImmersivePlayerProps {
  source: PlaySource
  onClose: () => void
}

// Wheel travel (px of deltaY) that counts as one deliberate step.
const WHEEL_STEP_PX = 60
// Lock stepping until the slide transition settles (t-med 240ms + margin) —
// this is what absorbs trackpad inertia instead of skipping three clips.
const STEP_LOCK_MS = 340
// When within this many of the end, prefetch more via loadMore().
const PREFETCH_WITHIN = 3
// Chrome (chip/close/rail overlays) fades after this much pointer stillness.
const IDLE_MS = 2500
// localStorage keys: mute preference; one-time "scroll for next" hint.
const MUTE_KEY = 'player:muted'
const HINT_KEY = 'player:hinted'

// Set of gif ids the user has liked, so the heart reflects both in-session
// likes and ones from the past (feeds don't return per-gif like state). Seeded
// from cache instantly, then reconciled with the server once per app run.
const likedIds = new Set<string>()
let likedIdsPromise: Promise<void> | null = null
function loadLikedIds(): Promise<void> {
  if (!likedIdsPromise) {
    ;(readCache<string[]>('likedIds') ?? []).forEach((id) => likedIds.add(id))
    likedIdsPromise = window.api
      .getLikedIds()
      .then((ids) => {
        ids.forEach((id) => likedIds.add(id))
        writeCache('likedIds', [...likedIds])
      })
      .catch(() => undefined)
  }
  return likedIdsPromise
}

/**
 * Full-screen immersive player built as a vertical pager: the current clip and
 * its neighbours are mounted as stacked slides translated ±100%, so stepping
 * slides the deck (and the next clip is already buffering) instead of
 * hard-swapping one <video>. Wheel input is accumulated and locked per step —
 * a trackpad flick advances exactly one clip. Keyboard: ↑/↓ step, Space
 * play/pause, ←/→ seek, M mute, L like, S save, Esc closes. Chrome fades
 * while the pointer is idle. The rail carries Save, Like, Copy link, Follow
 * and Add-to-collection; like changes broadcast `rgd:like-changed`.
 */
export default function ImmersivePlayer({ source, onClose }: ImmersivePlayerProps): JSX.Element {
  const notify = useNotify()
  const { navigate } = useNav()
  const { isBlocked } = useBlockedTags()
  const { quality } = useQuality()

  const [items, setItems] = useState<Content[]>(source.items)
  const [index, setIndex] = useState(
    Math.min(Math.max(source.index, 0), Math.max(source.items.length - 1, 0))
  )
  const [nicheVote, setNicheVote] = useState<'up' | 'down' | null>(null)
  const [liked, setLiked] = useState(false)

  // --- video control state -------------------------------------------------
  const [playing, setPlaying] = useState(true)
  const [muted, setMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  // --- follow state (shared lib/follows cache) ------------------------------
  const [following, setFollowing] = useState(false)
  const [collectionOpen, setCollectionOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)

  // --- idle chrome ----------------------------------------------------------
  const [idle, setIdle] = useState(false)
  const idleTimer = useRef<number | undefined>(undefined)

  // --- one-time hint ---------------------------------------------------------
  const [showHint] = useState<boolean>(() => {
    try {
      return localStorage.getItem(HINT_KEY) !== '1'
    } catch {
      return true
    }
  })

  // --- "see similar" mode: scroll into gifs recommended for one anchor clip ---
  const [similar, setSimilar] = useState(false)
  const similarRef = useRef(false)
  const similarAnchorRef = useRef<string | null>(null)
  const similarPageRef = useRef(1)
  // The feed to return to when leaving similar mode.
  const savedFeedRef = useRef<{ items: Content[]; index: number } | null>(null)

  // One <video> per mounted slide, keyed by content id.
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const saveSplitRef = useRef<HTMLDivElement>(null)
  const wheelAccRef = useRef(0)
  const stepLockRef = useRef(false)
  const loadingRef = useRef(false)
  // True while the pointer is over the scrubber — suppresses wheel-to-next.
  const overScrubberRef = useRef(false)
  // Track the latest items/index for callbacks without stale closures.
  const itemsRef = useRef(items)
  itemsRef.current = items
  const indexRef = useRef(index)
  indexRef.current = index

  const current: Content | undefined = items[index]

  // Latest mute preference, read inside startPlayback without re-creating it.
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  // Latest clip id, so async loads can target the right clip.
  const currentIdRef = useRef(current?.id)
  currentIdRef.current = current?.id

  const currentVideo = useCallback(
    (): HTMLVideoElement | undefined =>
      currentIdRef.current ? videoRefs.current.get(currentIdRef.current) : undefined,
    []
  )

  // Whether playback SHOULD be running — set false only by an explicit pause.
  // onCanPlay refires after every seek, so without this a paused clip would
  // resume the moment the user scrubs or presses ←/→.
  const wantPlayingRef = useRef(true)

  // Autoplay is permitted (main sets autoplay-policy=no-user-gesture-required),
  // so play the current slide with the user's mute preference. Wired to the
  // video's onCanPlay and the per-clip effect so it runs the moment the media
  // is ready.
  const startPlayback = useCallback((): void => {
    if (!wantPlayingRef.current) return
    const v = currentVideo()
    if (!v) return
    v.muted = mutedRef.current
    v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }, [currentVideo])

  // --- pagination: append more when nearing the end ------------------------
  const appendUnique = useCallback((more: Content[]): void => {
    if (!more.length) return
    setItems((prev) => {
      const seen = new Set(prev.map((c) => c.id))
      return [...prev, ...more.filter((c) => !seen.has(c.id))]
    })
  }, [])

  const maybeLoadMore = useCallback(
    async (nextIndex: number): Promise<void> => {
      const list = itemsRef.current
      if (loadingRef.current) return
      if (nextIndex < list.length - PREFETCH_WITHIN) return

      // In "see similar" mode, keep paging the recommendations for the anchor.
      if (similarRef.current && similarAnchorRef.current) {
        loadingRef.current = true
        try {
          similarPageRef.current += 1
          const res = await window.api.recommendSimilar(
            similarAnchorRef.current,
            similarPageRef.current
          )
          appendUnique(res.contents.filter((c) => !isBlocked(c)))
        } catch {
          /* ignore — playback continues with what we have */
        } finally {
          loadingRef.current = false
        }
        return
      }

      if (!source.loadMore) return
      loadingRef.current = true
      try {
        const more = await source.loadMore()
        appendUnique(more)
      } catch {
        /* ignore — playback continues with what we have */
      } finally {
        loadingRef.current = false
      }
    },
    [source, appendUnique, isBlocked]
  )

  // Toggle recommendations: on, scrolling continues into gifs similar to the
  // current clip; off, restores the original feed at the spot you left it.
  const toggleSimilar = useCallback(async (): Promise<void> => {
    const cur = itemsRef.current[indexRef.current]
    if (!cur) return
    if (similarRef.current) {
      const saved = savedFeedRef.current
      similarRef.current = false
      setSimilar(false)
      if (saved) {
        setItems(saved.items)
        setIndex(saved.index)
      }
      return
    }
    const anchor = cur.id
    savedFeedRef.current = { items: itemsRef.current, index: indexRef.current }
    similarAnchorRef.current = anchor
    similarPageRef.current = 1
    try {
      const res = await window.api.recommendSimilar(anchor, 1)
      const recs = res.contents.filter((c) => c.id !== anchor && !isBlocked(c))
      similarRef.current = true
      setItems([cur, ...recs])
      setIndex(0)
      setSimilar(true)
    } catch (e) {
      notify('Couldn’t load similar: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }, [isBlocked, notify])

  // --- stepping between clips (locked while the slide transition runs) ------
  // The target index is computed from refs in the event handler itself: React
  // only runs setState updaters eagerly when the fiber has no pending update,
  // and both call sites setIdle() first — side effects inside the updater
  // would silently not run on those steps.
  const step = useCallback(
    (delta: number): void => {
      if (stepLockRef.current) return
      const i = indexRef.current
      const next = Math.min(Math.max(i + delta, 0), itemsRef.current.length - 1)
      if (next === i) return
      setIndex(next)
      if (delta > 0) void maybeLoadMore(next)
      stepLockRef.current = true
      window.setTimeout(() => {
        stepLockRef.current = false
        wheelAccRef.current = 0 // require a fresh gesture after each step
      }, STEP_LOCK_MS)
      try {
        localStorage.setItem(HINT_KEY, '1')
      } catch {
        /* non-fatal */
      }
    },
    [maybeLoadMore]
  )

  // Reset per-clip state AND kick off playback whenever the clip changes —
  // including the very first mount. Pauses (and rewinds) every non-current
  // slide so exactly one clip is ever audible/playing. Seeding `duration` from
  // the known clip length makes the scrubber usable before metadata loads.
  useEffect(() => {
    setNicheVote(null)
    setLiked(current ? likedIds.has(current.id) : false)
    setCurrentTime(0)
    setDuration(current && Number.isFinite(current.duration) ? current.duration : 0)
    setCollectionOpen(false)
    setSaveOpen(false)
    // The previous slide's scrubber unmounts without a mouseleave — clear the
    // wheel suppression or navigation could stay dead until the next hover.
    overScrubberRef.current = false
    wantPlayingRef.current = true
    for (const [id, v] of videoRefs.current) {
      if (id !== current?.id) {
        v.pause()
        if (v.currentTime !== 0) v.currentTime = 0
      }
    }
    startPlayback()
    // Prefetch even when the index didn't move to get here — opening the player
    // directly on the feed's last item must still start pagination.
    void maybeLoadMore(indexRef.current + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  // --- load the follows set once, then track changes from anywhere ---------
  useEffect(() => {
    let alive = true
    void loadFollows().then(() => {
      if (alive && currentIdRef.current) {
        const cur = itemsRef.current[indexRef.current]
        if (cur) setFollowing(isFollowing(cur.username))
      }
    })
    const onChange = (e: Event): void => {
      const { username, following } = (e as CustomEvent<FollowChange>).detail
      const cur = itemsRef.current[indexRef.current]
      if (cur && cur.username.toLowerCase() === username.toLowerCase()) setFollowing(following)
    }
    const onReloaded = (): void => {
      const cur = itemsRef.current[indexRef.current]
      if (cur) setFollowing(isFollowing(cur.username))
    }
    window.addEventListener(FOLLOW_EVENT, onChange)
    window.addEventListener(FOLLOWS_RELOADED_EVENT, onReloaded)
    return () => {
      alive = false
      window.removeEventListener(FOLLOW_EVENT, onChange)
      window.removeEventListener(FOLLOWS_RELOADED_EVENT, onReloaded)
    }
  }, [])

  // Load the user's liked-gif ids once, then light the heart for the current
  // clip if it was already liked in the past.
  useEffect(() => {
    let alive = true
    void loadLikedIds().then(() => {
      if (alive && currentIdRef.current) setLiked(likedIds.has(currentIdRef.current))
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!current) return
    setFollowing(isFollowing(current.username))
  }, [current])

  // Pause every element on unmount. Do NOT strip src / call load() in
  // cleanups: under React StrictMode's dev double-mount that blanked the first
  // clip until the user scrolled (the old "autoplay only after scrolling" bug).
  useEffect(() => {
    const refs = videoRefs.current
    return () => {
      for (const v of refs.values()) v.pause()
    }
  }, [])

  // Keep the current element's muted flag in sync with the button + persist.
  useEffect(() => {
    const v = currentVideo()
    if (v) v.muted = muted
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
    } catch {
      /* storage may be unavailable — non-fatal */
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

  const seekBy = useCallback(
    (delta: number): void => {
      const v = currentVideo()
      if (!v || !Number.isFinite(v.duration)) return
      v.currentTime = Math.min(Math.max(v.currentTime + delta, 0), v.duration)
    },
    [currentVideo]
  )

  const onSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      const v = currentVideo()
      const t = Number(e.target.value)
      setCurrentTime(t)
      if (v) v.currentTime = t
    },
    [currentVideo]
  )

  // Save the current clip — at the app default quality, or an explicit
  // override from the split-button menu.
  const save = useCallback(
    async (q?: Quality): Promise<void> => {
      const cur = itemsRef.current[indexRef.current]
      if (!cur) return
      const chosen = q ?? quality
      setSaveOpen(false)
      try {
        await window.api.downloadContents([cur], cur.username, chosen)
        notify(`Download queued (${chosen.toUpperCase()}) — @${cur.username}`, 'success')
      } catch (e) {
        notify('Save failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
      }
    },
    [notify, quality]
  )

  const copyLink = useCallback(async (): Promise<void> => {
    const cur = itemsRef.current[indexRef.current]
    if (!cur) return
    try {
      await navigator.clipboard.writeText('https://www.redgifs.com/watch/' + cur.id)
      notify('Link copied', 'success')
    } catch (e) {
      notify('Copy failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }, [notify])

  // Optimistic follow toggle via the shared cache — the FOLLOW_EVENT listener
  // above (and creator cards elsewhere) reflect the flip; lib reverts on error.
  const toggleFollow = useCallback(async (): Promise<void> => {
    if (!current) return
    const next = !following
    try {
      await setFollow(current.username, next)
    } catch (e) {
      notify(
        (next ? 'Follow' : 'Unfollow') + ' failed: ' + (e instanceof Error ? e.message : String(e)),
        'error'
      )
    }
  }, [current, following, notify])

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

  // Optimistic like toggle: flip immediately, revert + notify on failure.
  // Broadcasts `rgd:like-changed` on success so grids (Likes) stay in sync.
  const toggleLike = useCallback(async (): Promise<void> => {
    const cur = itemsRef.current[indexRef.current]
    if (!cur) return
    const next = !liked
    setLiked(next)
    if (next) likedIds.add(cur.id)
    else likedIds.delete(cur.id)
    try {
      if (next) await window.api.likeGif(cur.id)
      else await window.api.unlikeGif(cur.id)
      writeCache('likedIds', [...likedIds])
      window.dispatchEvent(
        new CustomEvent('rgd:like-changed', { detail: { gifId: cur.id, liked: next } })
      )
    } catch (e) {
      setLiked(!next)
      if (next) likedIds.delete(cur.id)
      else likedIds.add(cur.id)
      notify(
        (next ? 'Like' : 'Unlike') + ' failed: ' + (e instanceof Error ? e.message : String(e)),
        'error'
      )
    }
  }, [liked, notify])

  // --- keyboard ---------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Never hijack typing (e.g. the "New collection" name field).
      if (
        e.target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) &&
        (e.target as HTMLInputElement).type !== 'range'
      ) {
        return
      }
      setIdle(false)
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          if (saveOpen) setSaveOpen(false)
          else if (collectionOpen) setCollectionOpen(false)
          else onClose()
          break
        case 'ArrowDown':
          e.preventDefault()
          step(1)
          break
        case 'ArrowUp':
          e.preventDefault()
          step(-1)
          break
        case 'ArrowRight':
          e.preventDefault()
          seekBy(5)
          break
        case 'ArrowLeft':
          e.preventDefault()
          seekBy(-5)
          break
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'm':
        case 'M':
          setMuted((m) => !m)
          break
        case 'l':
        case 'L':
          void toggleLike()
          break
        case 's':
        case 'S':
          void save()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, step, seekBy, togglePlay, toggleLike, save, collectionOpen, saveOpen])

  // --- wheel: accumulate deliberate travel, one step per gesture -------------
  const onWheel = useCallback(
    (e: React.WheelEvent): void => {
      if (overScrubberRef.current) return
      setIdle(false)
      if (stepLockRef.current) return // absorb trackpad inertia during the slide
      wheelAccRef.current += e.deltaY
      if (Math.abs(wheelAccRef.current) >= WHEEL_STEP_PX) {
        const dir = wheelAccRef.current > 0 ? 1 : -1
        wheelAccRef.current = 0
        step(dir)
      }
    },
    [step]
  )

  // Outside clicks close the save-quality menu.
  useEffect(() => {
    if (!saveOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (saveSplitRef.current && !saveSplitRef.current.contains(e.target as Node)) {
        setSaveOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc, true)
    return () => document.removeEventListener('mousedown', onDoc, true)
  }, [saveOpen])

  // --- idle chrome: fade the overlays while the pointer rests ----------------
  const wake = useCallback((): void => {
    setIdle(false)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      // Keep chrome up while paused or while a menu is open.
      if (!collectionOpen && playing) setIdle(true)
    }, IDLE_MS)
  }, [collectionOpen, playing])

  useEffect(() => {
    wake()
    return () => window.clearTimeout(idleTimer.current)
  }, [wake])

  if (!current) {
    return (
      <div className="player" onClick={onClose}>
        <div className="player-empty">Nothing to play.</div>
      </div>
    )
  }

  const avatarLetter = (current.username?.[0] ?? '?').toUpperCase()

  // Close the player, then navigate — so the destination page is on top.
  const goCreator = (): void => {
    onClose()
    navigate({ name: 'creator', username: current.username })
  }
  const goTag = (tag: string): void => {
    onClose()
    navigate({ name: 'tag', tag })
  }

  // Mount the current slide plus one neighbour each way: the next clip is
  // already buffering (preload="auto") when the user steps onto it.
  const first = Math.max(0, index - 1)
  const slides = items.slice(first, Math.min(items.length, index + 2))
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0

  return (
    <div
      className={`player ${idle ? 'idle' : ''}`}
      onWheel={onWheel}
      onMouseMove={wake}
      role="dialog"
      aria-modal="true"
      aria-label="Player"
    >
      {/* source chip (top-left) */}
      <div className="player-chip player-chrome">
        {similar ? 'Similar' : source.label} — {index + 1} / {items.length}
      </div>

      {/* close (top-right) */}
      <button
        className="player-close player-chrome"
        type="button"
        onClick={onClose}
        aria-label="Close player"
        title="Close (Esc)"
      >
        <IconX />
      </button>

      {/* stage: vertical pager */}
      <div className="player-stage">
        {slides.map((c, s) => {
          const i = first + s
          const isCurrent = i === index
          const src = c.urls.hd || c.urls.sd
          const poster = c.urls.thumbnail || c.urls.poster
          return (
            <div
              key={c.id}
              className="player-slide"
              style={{ transform: `translateY(${(i - index) * 100}%)` }}
              aria-hidden={!isCurrent}
            >
              <div className="player-wrap">
                <video
                  ref={(el) => {
                    if (el) videoRefs.current.set(c.id, el)
                    else videoRefs.current.delete(c.id)
                  }}
                  className="player-video"
                  src={src}
                  poster={poster}
                  controls={false}
                  loop
                  playsInline
                  muted={!isCurrent || muted}
                  preload="auto"
                  autoPlay={isCurrent}
                  onClick={isCurrent ? togglePlay : undefined}
                  onCanPlay={isCurrent ? startPlayback : undefined}
                  onLoadedMetadata={
                    isCurrent
                      ? (e) => {
                          const d = e.currentTarget.duration
                          if (Number.isFinite(d) && d > 0) setDuration(d)
                        }
                      : undefined
                  }
                  onPlay={isCurrent ? () => setPlaying(true) : undefined}
                  onPause={isCurrent ? () => setPlaying(false) : undefined}
                  onTimeUpdate={
                    isCurrent ? (e) => setCurrentTime(e.currentTarget.currentTime) : undefined
                  }
                />

                {isCurrent && (
                  <>
                    {!playing && (
                      <div className="player-paused-badge" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    )}

                    {/* mute + like, overlaid on the video's right edge */}
                    <div className="player-vrail player-chrome" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="player-obtn"
                        onClick={() => setMuted((m) => !m)}
                        aria-label={muted ? 'Unmute' : 'Mute'}
                        aria-pressed={muted}
                        title={muted ? 'Unmute (M)' : 'Mute (M)'}
                      >
                        {muted ? (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M11 5 6 9H2v6h4l5 4z" />
                            <path d="m23 9-6 6" />
                            <path d="m17 9 6 6" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M11 5 6 9H2v6h4l5 4z" />
                            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                            <path d="M19 5a9 9 0 0 1 0 14" />
                          </svg>
                        )}
                      </button>
                      <button
                        type="button"
                        className={`player-obtn ${liked ? 'on' : ''}`}
                        onClick={toggleLike}
                        aria-pressed={liked}
                        title={liked ? 'Unlike (L)' : 'Like (L)'}
                      >
                        <svg viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
                        </svg>
                      </button>
                    </div>

                    {/* mono time readout */}
                    <div className="player-time player-chrome">
                      {formatDuration(currentTime)} / {formatDuration(duration)}
                    </div>

                    {/* full-width timeline pinned to the video's bottom edge */}
                    <input
                      type="range"
                      className="scrub"
                      style={{ ['--p' as string]: String(progress) }}
                      min={0}
                      max={duration || 0}
                      step={0.1}
                      value={Math.min(currentTime, duration || 0)}
                      onChange={onSeek}
                      onClick={(e) => e.stopPropagation()}
                      onWheel={(e) => e.stopPropagation()}
                      onMouseEnter={() => {
                        overScrubberRef.current = true
                      }}
                      onMouseLeave={() => {
                        overScrubberRef.current = false
                      }}
                      aria-label="Seek"
                    />
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* right action rail */}
      <aside className="player-rail">
        <div className="player-creator">
          <div className="player-avatar" aria-hidden="true">{avatarLetter}</div>
          <button
            type="button"
            className="player-handle"
            title={`View @${current.username}`}
            onClick={goCreator}
          >
            @{current.username}
          </button>
        </div>

        <div className="save-split" ref={saveSplitRef}>
          <button
            className="btn btn-ember player-save save-main"
            type="button"
            onClick={() => void save()}
            title="Save (S)"
          >
            <IconDownload />
            Save {quality.toUpperCase()}
          </button>
          <button
            className="btn btn-ember save-caret"
            type="button"
            aria-haspopup="menu"
            aria-expanded={saveOpen}
            aria-label="Save quality options"
            title="Pick quality for this save"
            onClick={() => setSaveOpen((o) => !o)}
          >
            <IconChevronDown />
          </button>
          {saveOpen && (
            <div className="menu-panel" role="menu" aria-label="Save quality">
              <button type="button" role="menuitem" className="menu-row" onClick={() => void save('hd')}>
                Save in HD
              </button>
              <button type="button" role="menuitem" className="menu-row" onClick={() => void save('sd')}>
                Save in SD
              </button>
              <hr className="menu-sep" />
              <div className="menu-hint">Default is {quality.toUpperCase()} — change it in Settings.</div>
            </div>
          )}
        </div>

        <div className="player-actions">
          <button className="btn" type="button" onClick={copyLink} title="Copy link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7" />
              <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.8-1.7" />
            </svg>
            Copy
          </button>

          <button
            className={`btn ${following ? 'on' : ''}`}
            type="button"
            onClick={toggleFollow}
            aria-pressed={following}
            title={following ? 'Unfollow' : 'Follow'}
          >
            <IconUsers />
            {following ? 'Following' : 'Follow'}
          </button>
        </div>

        <div style={{ position: 'relative' }}>
          <button
            className="btn player-actions-full"
            type="button"
            onClick={() => setCollectionOpen((o) => !o)}
            aria-expanded={collectionOpen}
            aria-haspopup="menu"
            title="Add to collection"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h10" />
              <path d="M18 15v6M21 18h-6" />
            </svg>
            Add to collection
          </button>
          {collectionOpen && (
            <CollectionMenu contentId={current.id} onClose={() => setCollectionOpen(false)} />
          )}
        </div>

        <button
          type="button"
          className={`switch ${similar ? 'on' : ''}`}
          onClick={toggleSimilar}
          aria-pressed={similar}
          title={similar ? 'Back to the feed' : 'Scroll into gifs similar to this one'}
        >
          <span className="switch-track" aria-hidden="true">
            <span className="switch-dot" />
          </span>
          {similar ? 'Similar' : 'See similar'}
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
                title="Fits this niche"
              >
                Fits
              </button>
              <button
                type="button"
                className={`btn btn-sm ${nicheVote === 'down' ? 'on' : ''}`}
                onClick={() => vote('down')}
                aria-pressed={nicheVote === 'down'}
                title="Doesn't fit this niche"
              >
                Off
              </button>
            </div>
          </div>
        )}

        {current.tags.length > 0 && (
          <div className="player-tags">
            {current.tags.slice(0, 8).map((t) => (
              <button
                type="button"
                className="player-tag"
                key={t}
                title={`Browse #${t}`}
                onClick={() => goTag(t)}
              >
                #{t}
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* one-time bottom hint */}
      {showHint && <div className="player-hint">scroll ↕ · space pauses · esc closes</div>}
    </div>
  )
}
