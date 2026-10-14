import { ToastProvider } from './context/toast'
import { AuthProvider } from './context/auth'
import { SettingsProvider } from './context/settings'
import { DownloadsProvider } from './context/downloads'
import { PlayerProvider } from './player/PlayerProvider'
import { NavProvider, NavScreens, type RouteDef } from './nav'
import TabBar from './components/TabBar'
import Settings from './screens/Settings'
import Home from './screens/Home'
import Discover from './screens/Discover'
import Search from './screens/Search'
import Creator from './screens/Creator'
import NicheDetail from './screens/NicheDetail'
import TagDetail from './screens/TagDetail'
import Library from './screens/Library'
import CollectionDetail from './screens/CollectionDetail'
import Downloads from './screens/Downloads'
import You from './screens/You'
import BackButtonHandler from './components/BackButtonHandler'

const ROUTES: RouteDef[] = [
  { pattern: '/', component: Home },
  { pattern: '/discover', component: Discover },
  { pattern: '/search/:query', component: Search },
  { pattern: '/creator/:username', component: Creator },
  { pattern: '/niche/:id', component: NicheDetail },
  { pattern: '/tag/:tag', component: TagDetail },
  { pattern: '/library', component: Library },
  { pattern: '/collection/:id', component: CollectionDetail },
  { pattern: '/downloads', component: Downloads },
  { pattern: '/you', component: You },
  { pattern: '/settings', component: Settings }
]

/**
 * App shell. NavProvider owns five independent, keep-alive tab stacks that
 * NavScreens renders; PlayerProvider sits inside it because the player
 * navigates (creator / tag taps).
 */
export default function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <SettingsProvider>
        <AuthProvider>
          <DownloadsProvider>
            <NavProvider routes={ROUTES}>
              <PlayerProvider>
                <BackButtonHandler />
                <div className="app">
                  <NavScreens />
                  <TabBar />
                </div>
              </PlayerProvider>
            </NavProvider>
          </DownloadsProvider>
        </AuthProvider>
      </SettingsProvider>
    </ToastProvider>
  )
}
