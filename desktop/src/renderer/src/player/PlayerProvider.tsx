import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import type { Content } from '@shared/types'
import ImmersivePlayer from './ImmersivePlayer'

export interface PlaySource {
  items: Content[]
  index: number
  label: string
  loadMore?: () => Promise<Content[]>
  nicheId?: string
}

interface PlayerContextValue {
  open: (src: PlaySource) => void
  close: () => void
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

/**
 * Owns the immersive-player overlay. `open(src)` mounts a full-screen player
 * over the app; `close()` dismisses it. Only one source is active at a time.
 */
export function PlayerProvider({ children }: { children: ReactNode }): JSX.Element {
  const [source, setSource] = useState<PlaySource | null>(null)

  const open = useCallback((src: PlaySource): void => setSource(src), [])
  const close = useCallback((): void => setSource(null), [])

  return (
    <PlayerContext.Provider value={{ open, close }}>
      {children}
      {source && <ImmersivePlayer source={source} onClose={close} />}
    </PlayerContext.Provider>
  )
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used within a PlayerProvider')
  return ctx
}
