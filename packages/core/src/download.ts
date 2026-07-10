import type { Content, DownloadRequest, Quality } from './types'

/** File extension from a media URL (query-stripped); defaults to mp4. */
export function extFromUrl(url: string): string {
  const path = url.split('?')[0]
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  if (dot > slash && dot !== -1) return path.slice(dot + 1)
  return 'mp4'
}

/** Strip characters illegal in file names on Windows/Android/desktop. */
export function sanitize(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_')
}

/** Media URL for the chosen quality, falling back to the other tier. */
export function pickUrl(c: Content, quality: Quality): string {
  const { hd, sd } = c.urls
  if (quality === 'sd') return sd || hd || ''
  return hd || sd || ''
}

/** `NNNN_<id>_<user>.<ext>` — zero-padded rank keeps gallery order stable. */
export function buildFilename(c: Content, rank: number): string {
  const ext = extFromUrl(c.urls.hd || c.urls.sd || '')
  return sanitize(`${String(rank).padStart(4, '0')}_${c.id}_${c.username}.${ext}`)
}

/** A `single`-type request for an already-resolved list of contents. */
export function buildContentsRequest(
  contents: Content[],
  username?: string,
  quality?: Quality
): DownloadRequest {
  return { type: 'single', username, contentIds: contents.map((c) => c.id), quality }
}
