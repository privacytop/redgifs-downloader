import {
  forwardRef,
  useEffect,
  useState,
  type ImgHTMLAttributes,
  type VideoHTMLAttributes
} from 'react'
import { MediaCache, cachedFileSrc, hasNativeMediaCache } from '../plugins/mediaCache'
import { LruCache } from '../lib/lru'

/**
 * Image loading policy — the old one waited for the native cache plugin to
 * DOWNLOAD the thumbnail (4 serial HTTP/1.1 workers, one bridge round trip
 * each) before the <img> got any src at all, so a 60-tile grid took 10s+ to
 * fill. Now:
 *
 *   1. the <img> gets the remote URL immediately (the WebView fetches with
 *      HTTP/2, in parallel, through its own HTTP cache);
 *   2. in parallel we ask the native cache whether it already has the file
 *      (`lookup` — disk only, ms) and swap to the file:// src on a hit;
 *   3. on a miss the native cache downloads it in the background so the NEXT
 *      app start is offline-fast. Skipped when the user has Data Saver on.
 *
 * Results are memoised per key for the session so a tile re-mount or a second
 * grid showing the same gif does no bridge call at all.
 */
const known = new LruCache<string, string | null>(6000) // key → file src, or null = not cached
const pending = new Map<string, Promise<string | null>>()
const persisting = new Set<string>()

function saveData(): boolean {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
  return nav.connection?.saveData === true
}

function lookup(key: string): Promise<string | null> {
  const hit = known.get(key)
  if (hit !== undefined) return Promise.resolve(hit)
  let p = pending.get(key)
  if (!p) {
    p = MediaCache.lookup({ key })
      .then((r) => (r.cached && r.path ? cachedFileSrc(r.path) : null))
      .catch(() => null)
      .then((v) => {
        known.set(key, v)
        pending.delete(key)
        return v
      })
    pending.set(key, p)
  }
  return p
}

function persist(key: string, url: string): void {
  if (persisting.has(key) || saveData()) return
  persisting.add(key)
  MediaCache.thumbnail({ key, url })
    .then((r) => known.set(key, cachedFileSrc(r.path)))
    .catch(() => undefined)
    .finally(() => persisting.delete(key))
}

/** Forget a cache entry (after the file turned out corrupt). */
function forget(key: string): void {
  known.delete(key)
  void MediaCache.invalidate({ key }).catch(() => undefined)
}

export function useCachedImageUrl(cacheKey: string, remoteUrl?: string): string | undefined {
  const native = hasNativeMediaCache()
  const [source, setSource] = useState<string | undefined>(() =>
    native ? (known.get(cacheKey) ?? remoteUrl) : remoteUrl
  )

  useEffect(() => {
    if (!remoteUrl) {
      setSource(undefined)
      return
    }
    if (!native) {
      setSource(remoteUrl)
      return
    }
    let live = true
    const hit = known.get(cacheKey)
    if (hit) {
      setSource(hit)
      return
    }
    setSource(remoteUrl) // paint from the network right away
    void lookup(cacheKey).then((file) => {
      if (!live) return
      if (file) setSource(file)
      else persist(cacheKey, remoteUrl)
    })
    return () => {
      live = false
    }
  }, [cacheKey, native, remoteUrl])

  return source
}

interface CachedImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  cacheKey: string
  src: string
}

/** Native-file-backed image with a network fallback if a cache entry is corrupt. */
export const CachedImage = forwardRef<HTMLImageElement, CachedImageProps>(function CachedImage(
  { cacheKey, src: remoteUrl, onError, ...props },
  ref
) {
  const cachedUrl = useCachedImageUrl(cacheKey, remoteUrl)
  const [fallback, setFallback] = useState(false)

  useEffect(() => setFallback(false), [cacheKey, remoteUrl])

  return (
    <img
      {...props}
      ref={ref}
      src={fallback ? remoteUrl : cachedUrl}
      onError={(event) => {
        if (!fallback && cachedUrl && cachedUrl !== remoteUrl) {
          setFallback(true)
          forget(cacheKey)
        }
        onError?.(event)
      }}
    />
  )
})

interface CachedVideoProps extends Omit<VideoHTMLAttributes<HTMLVideoElement>, 'poster'> {
  posterKey: string
  posterUrl?: string
}

/** Video whose poster comes from the persistent thumbnail cache. */
export const CachedVideo = forwardRef<HTMLVideoElement, CachedVideoProps>(function CachedVideo(
  { posterKey, posterUrl, ...props },
  ref
) {
  const poster = useCachedImageUrl(posterKey, posterUrl)
  return <video {...props} ref={ref} poster={poster} />
})
