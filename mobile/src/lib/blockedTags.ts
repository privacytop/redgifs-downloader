import { useEffect, useState } from 'react'
import type { Content } from '@redloader/core'
import { api } from './api'
import { readCache, writeCache } from './cache'

/**
 * The signed-in user's blocked tags, kept as one lowercased Set for the whole
 * app run. The server does NOT reliably honour blocks on every feed (search,
 * tags, creators…), so every feed and the offline index filter through
 * `isBlocked`. Seeded from cache, refreshed from the profile after sign-in,
 * updated instantly when the user edits the list. `rgd:blocked-changed` fires
 * on every change so mounted feeds can re-filter.
 */
export const BLOCKED_EVENT = 'rgd:blocked-changed'
const CACHE_KEY = 'blockedTags'

let blocked = new Set<string>((readCache<string[]>(CACHE_KEY) ?? []).map((t) => t.toLowerCase()))
let version = 0

function broadcast(): void {
  version += 1
  window.dispatchEvent(new CustomEvent(BLOCKED_EVENT))
}

export function getBlockedTags(): ReadonlySet<string> {
  return blocked
}

export function isBlocked(c: Content): boolean {
  if (blocked.size === 0) return false
  const tags = c.tags
  for (let i = 0; i < tags.length; i++) if (blocked.has(tags[i].toLowerCase())) return true
  return false
}

export function setBlockedTags(tags: string[]): void {
  blocked = new Set(tags.map((t) => t.toLowerCase()))
  writeCache(CACHE_KEY, [...blocked])
  broadcast()
}

/** Pull the list from the profile (after sign-in / token restore). */
export async function loadBlockedTags(): Promise<void> {
  try {
    const profile = await api.getProfile()
    setBlockedTags(profile.blockedTags ?? [])
  } catch {
    /* keep the cached set */
  }
}

/** On sign-out: nothing is blocked for an anonymous session. */
export function clearBlockedTags(): void {
  setBlockedTags([])
}

/** Re-render subscriber: bumps whenever the blocked set changes. */
export function useBlockedVersion(): number {
  const [v, setV] = useState(version)
  useEffect(() => {
    const on = (): void => setV(version)
    window.addEventListener(BLOCKED_EVENT, on)
    return () => window.removeEventListener(BLOCKED_EVENT, on)
  }, [])
  return v
}
