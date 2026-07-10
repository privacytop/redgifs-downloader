import { useLocation, useNavigate } from 'react-router-dom'
import { IconCompass, IconDownload, IconHome, IconImage, IconUser } from './icons'

const TABS = [
  { path: '/', label: 'Home', Icon: IconHome, match: (p: string) => p === '/' },
  { path: '/discover', label: 'Discover', Icon: IconCompass, match: (p: string) => p.startsWith('/discover') || p.startsWith('/search') || p.startsWith('/niche') || p.startsWith('/tag') || p.startsWith('/creator') },
  { path: '/library', label: 'Library', Icon: IconImage, match: (p: string) => p.startsWith('/library') || p.startsWith('/collection') || p.startsWith('/likes') },
  { path: '/downloads', label: 'Downloads', Icon: IconDownload, match: (p: string) => p.startsWith('/downloads') },
  { path: '/you', label: 'You', Icon: IconUser, match: (p: string) => p.startsWith('/you') }
]

/** Bottom navigation. Detail routes keep their parent tab lit. */
export default function TabBar(): React.JSX.Element {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <nav className="tabbar">
      {TABS.map(({ path, label, Icon, match }) => {
        const on = match(pathname)
        return (
          <button
            key={path}
            className={`tab ${on ? 'on' : ''}`}
            onClick={() => navigate(path)}
            aria-current={on ? 'page' : undefined}
          >
            <Icon />
            {label}
          </button>
        )
      })}
    </nav>
  )
}
