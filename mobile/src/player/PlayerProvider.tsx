import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { Content } from '@redloader/core'
import Player from './Player'
import CollectionSheet from './CollectionSheet'
import { useDownloads } from '../context/downloads'
import { useToast } from '../context/toast'
import { useSettings } from '../context/settings'
import { useAuth } from '../context/auth'

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

/** Owns the full-screen player overlay + the add-to-collection sheet. */
export function PlayerProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [source, setSource] = useState<PlaySource | null>(null)
  const [collectFor, setCollectFor] = useState<Content | null>(null)
  const { enqueue } = useDownloads()
  const { quality } = useSettings()
  const { authenticated } = useAuth()
  const notify = useToast()

  const open = useCallback((src: PlaySource) => setSource(src), [])
  const close = useCallback(() => setSource(null), [])

  const save = useCallback(
    (c: Content) => {
      enqueue([c], `@${c.username}`, quality)
      notify(`Saving @${c.username} to your gallery (${quality.toUpperCase()})`, 'success')
    },
    [enqueue, quality, notify]
  )

  const collect = useCallback(
    (c: Content) => {
      if (!authenticated) {
        notify('Sign in to use collections', 'info')
        return
      }
      setCollectFor(c)
    },
    [authenticated, notify]
  )

  return (
    <Ctx.Provider value={{ open, close }}>
      {children}
      {source && <Player source={source} onClose={close} onSave={save} onCollect={collect} />}
      {collectFor && (
        <CollectionSheet contentId={collectFor.id} onClose={() => setCollectFor(null)} />
      )}
    </Ctx.Provider>
  )
}

export function usePlayer(): PlayerCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePlayer must be used within a PlayerProvider')
  return ctx
}
