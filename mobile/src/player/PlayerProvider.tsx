import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Content } from '@redloader/core'
import Player from './Player'
import CollectionSheet from './CollectionSheet'
import { useDownloadActions } from '../context/downloads'
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
  /** Close the collection sheet first, then the player. */
  dismissTop: () => boolean
}

const Ctx = createContext<PlayerCtx | null>(null)

/** Owns the full-screen player overlay + the add-to-collection sheet. */
export function PlayerProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [source, setSource] = useState<PlaySource | null>(null)
  const [collectFor, setCollectFor] = useState<Content | null>(null)
  const { enqueue } = useDownloadActions()
  const { downloadQuality } = useSettings()
  const { authenticated } = useAuth()
  const notify = useToast()

  const open = useCallback((src: PlaySource) => setSource(src), [])
  const close = useCallback(() => setSource(null), [])
  // Reads the latest overlay state through functional updates, so its identity
  // (and therefore the context value) never changes.
  const dismissTop = useCallback((): boolean => {
    let handled = false
    setCollectFor((cur) => {
      if (cur) handled = true
      return null
    })
    if (handled) return true
    setSource((cur) => {
      if (cur) handled = true
      return null
    })
    return handled
  }, [])

  const save = useCallback(
    (c: Content) => {
      enqueue([c], `@${c.username}`, downloadQuality)
      notify(`Saving @${c.username} to your gallery (${downloadQuality.toUpperCase()})`, 'success')
    },
    [downloadQuality, enqueue, notify]
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

  // Stable value: every Feed subscribes via usePlayer(), so a fresh object per
  // render would re-render every grid on each player/sheet state change.
  const value = useMemo<PlayerCtx>(() => ({ open, close, dismissTop }), [open, close, dismissTop])

  return (
    <Ctx.Provider value={value}>
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
