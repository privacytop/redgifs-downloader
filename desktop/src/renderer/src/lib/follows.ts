/**
 * Shared follow state: one lowercased-username Set per app run, loaded lazily
 * and mutated optimistically. Every consumer (player rail, creator page,
 * creator cards) reads the same cache and hears the same change event, so a
 * follow toggled anywhere lights up everywhere at once.
 */

export const FOLLOW_EVENT = 'rgd:follow-changed'
/** Fired after the whole cache is replaced (sign-in/out) — re-read isFollowing. */
export const FOLLOWS_RELOADED_EVENT = 'rgd:follows-reloaded'

export interface FollowChange {
  username: string
  following: boolean
}

let followsSet: Set<string> | null = null
let followsPromise: Promise<Set<string>> | null = null

// Auth changes invalidate the cache: signed-out browsing memoizes an empty
// Set, which would otherwise show "Follow" on already-followed creators for
// the rest of the run after a mid-session sign-in (and leak follows across
// accounts). Module scope runs once per renderer.
window.api.on('evt:auth:changed', () => {
  followsSet = null
  followsPromise = null
  void loadFollows().then(() => {
    window.dispatchEvent(new Event(FOLLOWS_RELOADED_EVENT))
  })
})

/** Loads the follows set once per app run; empty Set when unauthed/on error. */
export function loadFollows(): Promise<Set<string>> {
  if (!followsPromise) {
    followsPromise = window.api
      .getFollows()
      .then((names) => {
        followsSet = new Set(names.map((n) => n.toLowerCase()))
        return followsSet
      })
      .catch(() => {
        followsSet = new Set<string>()
        return followsSet
      })
  }
  return followsPromise
}

/** Synchronous peek — null until the first loadFollows() resolves. */
export function followsCache(): Set<string> | null {
  return followsSet
}

export function isFollowing(username: string): boolean {
  return followsSet?.has(username.toLowerCase()) ?? false
}

function broadcast(username: string, following: boolean): void {
  window.dispatchEvent(
    new CustomEvent<FollowChange>(FOLLOW_EVENT, { detail: { username, following } })
  )
}

/**
 * Optimistic follow/unfollow: the cache flips and broadcasts immediately, then
 * reverts (and re-broadcasts) if the API call fails — rethrowing so the caller
 * can toast the error.
 */
export async function setFollow(username: string, following: boolean): Promise<void> {
  const key = username.toLowerCase()
  const set = followsSet ?? (followsSet = new Set())
  if (following) set.add(key)
  else set.delete(key)
  broadcast(username, following)
  try {
    if (following) await window.api.followUser(username)
    else await window.api.unfollowUser(username)
  } catch (e) {
    if (following) set.delete(key)
    else set.add(key)
    broadcast(username, !following)
    throw e
  }
}
