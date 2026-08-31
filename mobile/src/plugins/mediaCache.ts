import { Capacitor, registerPlugin } from '@capacitor/core'

export interface MediaCacheStats {
  bytes: number
  count: number
  limitBytes: number
}

interface CachedThumbnail {
  path: string
  bytes: number
  cached: boolean
}

interface MediaCachePlugin {
  thumbnail(options: { key: string; url: string }): Promise<CachedThumbnail>
  invalidate(options: { key: string }): Promise<void>
  stats(): Promise<MediaCacheStats>
  clear(): Promise<MediaCacheStats>
}

export const MediaCache = registerPlugin<MediaCachePlugin>('MediaCache')

export function cachedFileSrc(path: string): string {
  return Capacitor.convertFileSrc(path)
}

export function hasNativeMediaCache(): boolean {
  return Capacitor.getPlatform() === 'android'
}
