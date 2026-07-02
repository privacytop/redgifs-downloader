import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Content } from '@shared/types'
import type { PlaySource } from './PlayerProvider'
import { useNotify } from '../context/notify'
import { useNav } from '../context/nav'
import { formatViews, formatDuration } from '../lib/format'
import CollectionMenu from './CollectionMenu'

interface ImmersivePlayerProps {
  source: PlaySource
  onClose: () => void
}

// Ignore wheel/key repeats faster than this while navigating clips.
const STEP_DEBOUNCE_MS = 350
// When within this many of the end, prefetch more via loadMore().
const PREFETCH_WITHIN = 3
// localStorage key remembering the user's mute preference (default: unmuted).
const MUTE_KEY = 'player:muted'

/**
 * Cached fetch of the accounts the signed-in user follows. Loaded once per app
 * run (module-level promise) so paging between clips doesn't refetch. Resolves
 * to a lowercased Set; degrades to an empty Set when unauthed / on error.
 */
let followsPromise: Promise<Set<string>> | null = null
function loadFollows(): Promise<Set<string>> {
  if (!followsPromise) {
    followsPromise = window.api
      .getFollows()
      .then((names) => new Set(names.map((n) => n.toLowerCase())))
      .catch(() => new Set<string>())
  }
  return followsPromise
}

/**
 * Full-screen immersive video player. Wheel + Arrow up/down move between clips
 * (debounced); clicking the video toggles play/pause; a control bar exposes
 * play/pause, mute, and a seek scrubber. The rail carries Save, Like, Copy
 * link, Follow and Add-to-collection actions. Save downloads the current clip;
 * Esc / the close button dismiss.
 */
export default function ImmersivePlayer({ source, onClose }: ImmersivePlayerProps): JSX.Element {
  const notify = useNotify()
  const { navigate } = useNav()

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

  // --- follow state --------------------------------------------------------
  const [follows, setFollows] = useState<Set<string> | null>(null)
  const [following, setFollowing] = useState(false)
  const [collectionOpen, setCollectionOpen] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const lastStepRef = useRef(0)
  const loadingRef = useRef(false)
  // True while the pointer is over the scrubber — suppresses wheel-to-next.
  const overScrubberRef = useRef(false)
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

  // Reset per-clip state (niche vote, like, playback, popover) when the clip changes.
  useEffect(() => {
    setNicheVote(null)
    setLiked(false)
    setPlaying(true)
    setCurrentTime(0)
    setDuration(0)
    setCollectionOpen(false)
  }, [index])

  // --- load the follows set once, then reflect the current creator ---------
  useEffect(() => {
    let alive = true
    void loadFollows().then((set) => {
      if (alive) setFollows(set)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!follows || !current) return
    setFollowing(follows.has(current.username.toLowerCase()))
  }, [follows, current])

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

  // --- wheel: scroll to advance (not while scrubbing) ----------------------
  const onWheel = useCallback(
    (e: React.WheelEvent): void => {
      if (overScrubberRef.current) return
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

  // Keep the element's muted flag in sync + persist the choice.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
    } catch {
      /* storage may be unavailable — non-fatal */
    }
  }, [muted])

  // Attempt to autoplay with audio when a new clip mounts; tolerate a block.
  const onLoadedMetadata = useCallback((): void => {
    const v = videoRef.current
    if (!v) return
    setDuration(Number.isFinite(v.duration) ? v.duration : 0)
    v.muted = muted
    void v.play().catch(() => {
      // Autoplay-with-audio blocked: reflect the paused state so the button is honest.
      setPlaying(false)
    })
  }, [muted])

  const togglePlay = useCallback((): void => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      void v.play().catch(() => setPlaying(false))
    } else {
      v.pause()
    }
  }, [])

  const onSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const v = videoRef.current
    const t = Number(e.target.value)
    setCurrentTime(t)
    if (v) v.currentTime = t
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

  const copyLink = useCallback(async (): Promise<void> => {
    if (!current) return
    try {
      await navigator.clipboard.writeText('https://www.redgifs.com/watch/' + current.id)
      notify('Link copied', 'success')
    } catch (e) {
      notify('Copy failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }, [current, notify])

  // Optimistic follow toggle: flip immediately, revert + notify on failure,
  // and keep the shared follows Set in sync so paging reflects the change.
  const toggleFollow = useCallback(async (): Promise<void> => {
    if (!current) return
    const username = current.username
    const next = !following
    setFollowing(next)
    setFollows((prev) => {
      const set = new Set(prev ?? [])
      if (next) set.add(username.toLowerCase())
      else set.delete(username.toLowerCase())
      return set
    })
    try {
      if (next) await window.api.followUser(username)
      else await window.api.unfollowUser(username)
    } catch (e) {
      setFollowing(!next)
      setFollows((prev) => {
        const set = new Set(prev ?? [])
        if (next) set.delete(username.toLowerCase())
        else set.add(username.toLowerCase())
        return set
      })
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
  const toggleLike = useCallback(async (): Promise<void> => {
    if (!current) return
    const next = !liked
    setLiked(next)
    try {
      if (next) await window.api.likeGif(current.id)
      else await window.api.unlikeGif(current.id)
    } catch (e) {
      setLiked(!next)
      notify((next ? 'Like' : 'Unlike') + ' failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }, [current, liked, notify])

  // Close the player, then navigate — so the destination page is on top.
  const goCreator = useCallback((): void => {
    if (!current) return
    onClose()
    navigate({ name: 'creator', username: current.username })
  }, [current, onClose, navigate])

  const goTag = useCallback(
    (tag: string): void => {
      onClose()
      navigate({ name: 'tag', tag })
    },
    [onClose, navigate]
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
        <div style={stageWrapStyle}>
          <video
            key={current.id}
            ref={videoRef}
            className="player-video"
            src={videoSrc}
            poster={poster}
            controls={false}
            autoPlay
            playsInline
            onClick={togglePlay}
            onLoadedMetadata={onLoadedMetadata}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onDurationChange={(e) =>
              setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)
            }
            style={{ cursor: 'pointer' }}
          />

          {/* control bar over the video bottom */}
          <div
            style={controlBarStyle}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              style={ctrlBtnStyle}
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
              title={playing ? 'Pause' : 'Play'}
            >
              {playing ? (
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={ctrlIconStyle}>
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={ctrlIconStyle}>
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <span style={timeStyle}>{formatDuration(currentTime)}</span>

            <input
              type="range"
              className="player-seek"
              style={seekStyle}
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              onChange={onSeek}
              onMouseEnter={() => {
                overScrubberRef.current = true
              }}
              onMouseLeave={() => {
                overScrubberRef.current = false
              }}
              aria-label="Seek"
            />

            <span style={timeStyle}>{formatDuration(duration)}</span>

            <button
              type="button"
              style={ctrlBtnStyle}
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute' : 'Mute'}
              aria-pressed={muted}
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={ctrlIconStyle}>
                  <path d="M11 5 6 9H2v6h4l5 4z" />
                  <path d="m23 9-6 6" />
                  <path d="m17 9 6 6" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={ctrlIconStyle}>
                  <path d="M11 5 6 9H2v6h4l5 4z" />
                  <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                  <path d="M19 5a9 9 0 0 1 0 14" />
                </svg>
              )}
            </button>
          </div>
        </div>
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

        <button className="btn btn-ember player-save" type="button" onClick={save}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
          Save
        </button>

        <button
          className={`btn player-like ${liked ? 'on' : ''}`}
          type="button"
          onClick={toggleLike}
          aria-pressed={liked}
          title={liked ? 'Unlike' : 'Like'}
        >
          <svg viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
          </svg>
          {liked ? 'Liked' : 'Like'}
        </button>

        <div style={actionRowStyle}>
          <button
            className="btn"
            type="button"
            style={actionBtnStyle}
            onClick={copyLink}
            title="Copy link"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={actionIconStyle}>
              <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7" />
              <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.8-1.7" />
            </svg>
            Copy
          </button>

          <button
            className={`btn ${following ? 'on' : ''}`}
            type="button"
            style={{ ...actionBtnStyle, ...(following ? followingStyle : null) }}
            onClick={toggleFollow}
            aria-pressed={following}
            title={following ? 'Unfollow' : 'Follow'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={actionIconStyle}>
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              {following ? <path d="m17 11 2 2 4-4" /> : <path d="M19 8v6M22 11h-6" />}
            </svg>
            {following ? 'Following' : 'Follow'}
          </button>
        </div>

        <div style={{ position: 'relative' }}>
          <button
            className="btn"
            type="button"
            style={{ ...actionBtnStyle, width: '100%' }}
            onClick={() => setCollectionOpen((o) => !o)}
            aria-expanded={collectionOpen}
            aria-haspopup="menu"
            title="Add to collection"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={actionIconStyle}>
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

      {/* bottom hint */}
      <div className="player-hint">scroll ↕ for next</div>
    </div>
  )
}

/* --- inline Midnight Press styles (tokens.css is off-limits for this task) -- */

const stageWrapStyle: CSSProperties = {
  position: 'relative',
  display: 'grid',
  placeItems: 'center',
  maxWidth: '100%'
}

const controlBarStyle: CSSProperties = {
  position: 'absolute',
  left: 12,
  right: 12,
  bottom: 12,
  zIndex: 3,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  background: 'rgba(12, 11, 14, 0.72)',
  border: '1px solid var(--line2)',
  borderRadius: 999,
  backdropFilter: 'blur(8px)'
}

const ctrlBtnStyle: CSSProperties = {
  flex: 'none',
  width: 32,
  height: 32,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'none',
  border: 0,
  borderRadius: 8,
  color: 'var(--cream)',
  cursor: 'pointer'
}

const ctrlIconStyle: CSSProperties = {
  width: 18,
  height: 18
}

const timeStyle: CSSProperties = {
  flex: 'none',
  fontFamily: 'var(--mono)',
  fontSize: 11,
  letterSpacing: '0.04em',
  color: 'var(--mut)',
  minWidth: 40,
  textAlign: 'center'
}

const seekStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 4,
  accentColor: 'var(--ember)',
  cursor: 'pointer'
}

const actionRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8
}

const actionBtnStyle: CSSProperties = {
  flex: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '9px 10px',
  fontSize: 13
}

const actionIconStyle: CSSProperties = {
  width: 15,
  height: 15,
  flex: 'none'
}

const followingStyle: CSSProperties = {
  color: 'var(--ember)',
  borderColor: 'var(--ember)'
}
