import { api } from './api'
import { readCache, writeCache } from './cache'

/**
 * Shared set of liked gif ids so the heart reflects likes from this session AND
 * the past (feeds don't return per-gif like state). Seeded from cache instantly,
 * reconciled with the server once per app run. A change event lets every open
 * player/grid update together, and `rgd:like-changed` carries {gifId, liked}.
 */
export const LIKE_EVENT = 'rgd:like-changed'
export interface LikeChange {
  gifId: string
  liked: boolean
}

const liked = new Set<string>()
let loadPromise: Promise<void> | null = null

export function loadLikedIds(): Promise<void> {
  if (!loadPromise) {
    ;(readCache<string[]>('likedIds') ?? []).forEach((id) => liked.add(id))
    loadPromise = api
      .getLikedIds()
      .then((ids) => {
        ids.forEach((id) => liked.add(id))
        writeCache('likedIds', [...liked])
      })
      .catch(() => undefined)
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
