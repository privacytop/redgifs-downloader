import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Content } from '@shared/types'

interface BlockedTagsValue {
  /** Lowercased blocked tags. Empty when signed out or the profile fetch fails. */
  blocked: Set<string>
  /** True when any of `content.tags` is a blocked tag. */
  isBlocked: (content: Content) => boolean
  /** Re-fetch the profile's blocked tags. */
  refresh: () => void
}

const BlockedTagsContext = createContext<BlockedTagsValue | null>(null)

/**
 * Loads the signed-in user's blocked tags from `getProfile()` and exposes an
 * `isBlocked(content)` predicate. Refreshes on mount and whenever auth changes.
 * When signed out or the fetch fails, `blocked` is empty so nothing is filtered.
 */
export function BlockedTagsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [blocked, setBlocked] = useState<Set<string>>(new Set())

  const refresh = useCallback((): void => {
    window.api
      .getProfile()
      .then((profile) => {
        setBlocked(new Set((profile.blockedTags || []).map((t) => t.toLowerCase())))
      })
      .catch(() => {
        setBlocked(new Set())
      })
  }, [])

  useEffect(() => {
    refresh()
    const offAuth = window.api.on('evt:auth:changed', () => refresh())
    return offAuth
  }, [refresh])

  const isBlocked = useCallback(
    (content: Content): boolean => {
      if (blocked.size === 0) return false
      return content.tags.some((t) => blocked.has(t.toLowerCase()))
    },
    [blocked]
  )

  const value = useMemo<BlockedTagsValue>(
    () => ({ blocked, isBlocked, refresh }),
    [blocked, isBlocked, refresh]
  )

  return <BlockedTagsContext.Provider value={value}>{children}</BlockedTagsContext.Provider>
}

/** Returns `{ blocked, isBlocked, refresh }`. Throws outside a BlockedTagsProvider. */
export function useBlockedTags(): BlockedTagsValue {
  const ctx = useContext(BlockedTagsContext)
  if (!ctx) throw new Error('useBlockedTags must be used within a BlockedTagsProvider')
  return ctx
}
