import { useEffect, useRef } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { useNav } from '../nav'
import { usePlayer } from '../player/PlayerProvider'
import { useToast } from '../context/toast'

const EXIT_WINDOW_MS = 2000

/** Android system-back policy: overlays, then the active tab stack, then double-back exit. */
export default function BackButtonHandler(): null {
  const { back } = useNav()
  const player = usePlayer()
  const notify = useToast()
  const lastExitPress = useRef(0)

  useEffect(() => {
    let disposed = false
    let remove: (() => Promise<void>) | undefined

    void CapacitorApp.addListener('backButton', () => {
      if (player.dismissTop()) return
      if (back()) {
        lastExitPress.current = 0
        return
      }
      const now = Date.now()
      if (now - lastExitPress.current <= EXIT_WINDOW_MS) {
        void CapacitorApp.exitApp()
      } else {
        lastExitPress.current = now
        notify('Press back again to exit', 'info')
      }
    }).then((handle) => {
      if (disposed) void handle.remove()
      else remove = handle.remove
    })

    return () => {
      disposed = true
      if (remove) void remove()
    }
  }, [back, notify, player])

  return null
}
