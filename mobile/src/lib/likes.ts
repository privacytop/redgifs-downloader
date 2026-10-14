import { api } from './api'
import { storage } from './storage'
import { readCache, writeCache } from './cache'

/**
 * Shared set of liked gif ids so the heart reflects likes from this session AND
 * the past (feeds don't return per-gif like state). Seeded from cache
 * instantly, then from the offline index's `liked` memberships (complete and
 * free once the library is indexed), then reconciled with the first pages of
 * the server's liked feed. A change event lets every open player/grid update
 * together, and `rgd:like-changed` carries {gifId, liked}.
 */
export const LIKE_EVENT = 'rgd:like-changed'
export interface LikeChange {
  gifId: string
  liked: boolean
}

// Pages of /feeds/liked to walk on top of the index (80 per page). The old
// 25-page walk fired 25 back-to-back requests through the shared rate limiter
// every time the player opened — a prime way to earn a 429.
const SERVER_PAGES = 6

const liked = new Set<string>()
let loadPromise: Promise<void> | null = null

export function loadLikedIds(): Promise<void> {
  if (!loadPromise) {
    ;(readCache<string[]>('likedIds') ?? []).forEach((id) => liked.add(id))
    loadPromise = (async () => {
      try {
        ;(await storage.likedIds()).forEach((id) => liked.add(id))
      } catch {
        /* index unavailable */
      }
      try {
        for (let page = 1; page <= SERVER_PAGES; page++) {
          const res = await api.getLikes(page)
          for (const c of res.contents) liked.add(c.id)
          if (!res.contents.length || !res.pages || page >= res.pages) break
        }
      } catch {
        /* not signed in / transient — keep what we have */
      }
      writeCache('likedIds', [...liked])
    })()
  }
  return loadPromise
}

export function isLiked(gifId: string): boolean {
  return liked.has(gifId)
}

/** Optimistic like/unlike: flips the cache + broadcasts, reverts on failure. */
export async function setLike(gifId: string, next: boolean): Promise<void> {
  if (next) liked.add(gifId)
  else liked.delete(gifId)
  window.dispatchEvent(new CustomEvent<LikeChange>(LIKE_EVENT, { detail: { gifId, liked: next } }))
  try {
    if (next) await api.likeGif(gifId)
    else await api.unlikeGif(gifId)
    writeCache('likedIds', [...liked])
    // Keep the offline index's liked membership in step so Library › Likes and
    // the heart agree without a reindex.
    if (next) void storage.addGifMembership(gifId, 'liked', 'liked').catch(() => undefined)
    else void storage.removeGifMembership(gifId, 'liked', 'liked').catch(() => undefined)
  } catch (e) {
    if (next) liked.delete(gifId)
    else liked.add(gifId)
    window.dispatchEvent(new CustomEvent<LikeChange>(LIKE_EVENT, { detail: { gifId, liked: !next } }))
    throw e
  }
}

/** Reset on sign-out so a previous session's likes don't linger. */
export function resetLikes(): void {
  liked.clear()
  loadPromise = null
  writeCache('likedIds', [])
}
