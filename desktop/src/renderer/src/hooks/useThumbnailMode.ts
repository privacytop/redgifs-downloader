import { useCallback, useEffect, useState } from 'react'

/**
 * How poster thumbnails are chosen for media cards:
 * - `default` — use the API's thumbnail as-is.
 * - `auto`    — use the thumbnail, but if it's near-black, swap in a mid-clip frame.
 * - `middle`  — always capture the frame at duration/2.
 * - `random`  — always capture a random frame in the first ~80% of the clip.
 */
export type ThumbMode = 'default' | 'auto' | 'middle' | 'random'

const VALID: ThumbMode[] = ['default', 'auto', 'middle', 'random']
const STORAGE_KEY = 'thumbnailMode'
// Same-window broadcast: localStorage's `storage` event only fires in OTHER
// windows, so a CustomEvent keeps every mounted card in sync when Settings
// changes the mode.
const CHANGE_EVENT = 'rgd:thumbmode-changed'

/**
 * Thumbnail-frame mode persisted to localStorage under `thumbnailMode`.
 * Defaults to `auto` when nothing is stored or storage is unavailable.
 * All instances stay in sync live via a window CustomEvent.
 */
export function useThumbnailMode(): [ThumbMode, (m: ThumbMode) => void] {
  const [mode, setMode] = useState<ThumbMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved && (VALID as string[]).includes(saved)) return saved as ThumbMode
    } catch {
      /* ignore — storage may be unavailable */
    }
    return 'auto'
  })

  useEffect(() => {
    const onChange = (e: Event): void => {
      const next = (e as CustomEvent<ThumbMode>).detail
      if (VALID.includes(next)) setMode(next)
    }
    window.addEventListener(CHANGE_EVENT, onChange)
    return () => window.removeEventListener(CHANGE_EVENT, onChange)
  }, [])

  const set = useCallback((m: ThumbMode): void => {
    setMode(m)
    try {
      localStorage.setItem(STORAGE_KEY, m)
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent<ThumbMode>(CHANGE_EVENT, { detail: m }))
  }, [])

  return [mode, set]
}

/**
 * Per-URL cache of captured frames (data URLs). `null` marks a URL we tried and
 * failed to capture (or that tainted the canvas), so we don't retry it.
 */
const frameCache = new Map<string, string | null>()

/**
 * Load `videoUrl` off-screen and grab a single frame as a data URL.
 *
 * `at`:
 *  - `middle` — seek to duration/2.
 *  - `random` — seek to a random point in the first ~80% of the clip.
 *
 * Requires the video host to allow cross-origin reads (see the
 * `Access-Control-Allow-Origin` header injected in the main process); otherwise
 * the canvas taints and this resolves to `null`. Results are cached per URL.
 */
export function captureFrame(videoUrl: string, at: 'middle' | 'random'): Promise<string | null> {
  if (!videoUrl) return Promise.resolve(null)
  if (frameCache.has(videoUrl)) return Promise.resolve(frameCache.get(videoUrl) ?? null)

  return new Promise<string | null>((resolve) => {
    let settled = false
    const video = document.createElement('video')

    const cleanup = (result: string | null): void => {
      if (settled) return
      settled = true
      frameCache.set(videoUrl, result)
      try {
        video.removeAttribute('src')
        video.load()
      } catch {
        /* ignore */
      }
      resolve(result)
    }

    try {
      video.crossOrigin = 'anonymous'
      video.muted = true
      video.playsInline = true
      video.preload = 'auto'

      // Guard against clips that never fire the expected events.
      const timer = window.setTimeout(() => cleanup(null), 8000)
      const finish = (result: string | null): void => {
        window.clearTimeout(timer)
        cleanup(result)
      }

      video.addEventListener('error', () => finish(null))

      video.addEventListener('loadedmetadata', () => {
        try {
          const dur = video.duration
          if (!Number.isFinite(dur) || dur <= 0) {
            finish(null)
            return
          }
          const target = at === 'middle' ? dur / 2 : Math.random() * dur * 0.8 + 0.1
          video.currentTime = Math.min(Math.max(target, 0), Math.max(dur - 0.05, 0))
        } catch {
          finish(null)
        }
      })

      video.addEventListener('seeked', () => {
        try {
          const w = video.videoWidth
          const h = video.videoHeight
          if (!w || !h) {
            finish(null)
            return
          }
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            finish(null)
            return
          }
          ctx.drawImage(video, 0, 0, w, h)
          // May throw SecurityError if the canvas is tainted.
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
          finish(dataUrl)
        } catch {
          finish(null)
        }
      })

      video.src = videoUrl
      video.load()
    } catch {
      cleanup(null)
    }
  })
}
