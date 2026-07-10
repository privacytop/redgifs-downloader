import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { Content } from '@redloader/core'
import Player from './Player'
import { useDownloads } from '../context/downloads'
import { useToast } from '../context/toast'

export interface PlaySource {
  items: Content[]
  index: number
  label: string
  loadMore?: () => Promise<Content[]>
}

interface PlayerCtx {
  open: (src: PlaySource) => void
  close: () => void
}

const Ctx = createContext<PlayerCtx | null>(null)

/** Owns the full-screen player overlay. One source active at a time. */
export function PlayerProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [source, setSource] = useState<PlaySource | null>(null)
  const { enqueue } = useDownloads()
  const notify = useToast()
  const open = useCallback((src: PlaySource) => setSource(src), [])
  const close = useCallback(() => setSource(null), [])

  const save = useCallback(
    (c: Content) => {
      enqueue([c], `@${c.username}`, 'hd')
      notify('Saving @' + c.username + ' to your gallery', 'success')
    },
    [enqueue, notify]
  )

  return (
    <Ctx.Provider value={{ open, close }}>
      {children}
      {source && <Player source={source} onClose={close} onSave={save} />}
    </Ctx.Provider>
  )
}

export function usePlayer(): PlayerCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePlayer must be used within a PlayerProvider')
  return ctx
}
