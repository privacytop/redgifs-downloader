import { useEffect, useRef } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePlayer } from '../player/PlayerProvider'
import { useToast } from '../context/toast'

const EXIT_WINDOW_MS = 2000

/** Android system-back policy: overlays, browser history, then double-back exit. */
export default function BackButtonHandler(): null {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const player = usePlayer()
  const notify = useToast()
  const lastExitPress = useRef(0)

  useEffect(() => {
    let disposed = false
    let remove: (() => Promise<void>) | undefined

    void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (player.dismissTop()) return

      if (canGoBack) {
        lastExitPress.current = 0
        navigate(-1)
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
  }, [navigate, notify, pathname, player])

  return null
}
