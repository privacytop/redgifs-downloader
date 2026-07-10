import { HashRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from './context/toast'
import { AuthProvider } from './context/auth'
import { DownloadsProvider } from './context/downloads'
import { PlayerProvider } from './player/PlayerProvider'
import TabBar from './components/TabBar'
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

export default function App(): React.JSX.Element {
  // HashRouter wraps PlayerProvider because the player (mounted by the
  // provider) uses useNavigate — it must be inside the Router.
  return (
    <ToastProvider>
      <AuthProvider>
        <DownloadsProvider>
          <HashRouter>
            <PlayerProvider>
              <div className="app">
                <div className="app-body">
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/discover" element={<Discover />} />
                    <Route path="/search/:query" element={<Search />} />
                    <Route path="/creator/:username" element={<Creator />} />
                    <Route path="/niche/:id" element={<NicheDetail />} />
                    <Route path="/tag/:tag" element={<TagDetail />} />
                    <Route path="/library" element={<Library />} />
                    <Route path="/collection/:id" element={<CollectionDetail />} />
                    <Route path="/downloads" element={<Downloads />} />
                    <Route path="/you" element={<You />} />
                  </Routes>
                </div>
                <TabBar />
              </div>
            </PlayerProvider>
          </HashRouter>
        </DownloadsProvider>
      </AuthProvider>
    </ToastProvider>
  )
}
