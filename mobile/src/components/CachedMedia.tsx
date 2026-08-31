import {
  forwardRef,
  useEffect,
  useState,
  type ImgHTMLAttributes,
  type VideoHTMLAttributes
} from 'react'
import {
  MediaCache,
  cachedFileSrc,
  hasNativeMediaCache
} from '../plugins/mediaCache'

export function useCachedImageUrl(cacheKey: string, remoteUrl?: string): string | undefined {
  const native = hasNativeMediaCache()
  const [source, setSource] = useState<string | undefined>(() => native ? undefined : remoteUrl)

  useEffect(() => {
    let live = true
    if (!remoteUrl) {
      setSource(undefined)
      return () => {
        live = false
      }
    }
    if (!native) {
      setSource(remoteUrl)
      return () => {
        live = false
      }
    }
    setSource(undefined)
    void MediaCache.thumbnail({ key: cacheKey, url: remoteUrl })
      .then(({ path }) => {
        if (live) setSource(cachedFileSrc(path))
      })
      .catch(() => {
        if (live) setSource(remoteUrl)
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
          void MediaCache.invalidate({ key: cacheKey }).catch(() => undefined)
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
