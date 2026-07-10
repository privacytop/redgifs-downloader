import { api } from './api'

/**
 * Shared follow state: one lowercased-username Set per app run, loaded lazily
 * and mutated optimistically, so the Following indicator on creator pages and
 * the player rail stay in sync. `rgd:follow-changed` carries {username, following}.
 */
export const FOLLOW_EVENT = 'rgd:follow-changed'
export interface FollowChange {
  username: string
  following: boolean
}

let set: Set<string> | null = null
let loadPromise: Promise<Set<string>> | null = null

export function loadFollows(): Promise<Set<string>> {
  if (!loadPromise) {
    loadPromise = api
      .getFollows()
      .then((names) => (set = new Set(names.map((n) => n.toLowerCase()))))
      .catch(() => (set = new Set<string>()))
  }
  return loadPromise
}

export function isFollowing(username: string): boolean {
  return set?.has(username.toLowerCase()) ?? false
}

function broadcast(username: string, following: boolean): void {
  window.dispatchEvent(
    new CustomEvent<FollowChange>(FOLLOW_EVENT, { detail: { username, following } })
  )
}

/** Optimistic follow/unfollow: flips the cache + broadcasts, reverts on error. */
export async function setFollow(username: string, following: boolean): Promise<void> {
  const key = username.toLowerCase()
  const s = set ?? (set = new Set())
  if (following) s.add(key)
  else s.delete(key)
  broadcast(username, following)
  try {
    if (following) await api.followUser(username)
    else await api.unfollowUser(username)
  } catch (e) {
    if (following) s.delete(key)
    else s.add(key)
    broadcast(username, !following)
    throw e
  }
}

export function resetFollows(): void {
  set = null
  loadPromise = null
}
