import { useNav, type TabId } from '../nav'
import { IconCompass, IconDownload, IconHome, IconImage, IconUser } from './icons'

const TABS: { id: TabId; label: string; Icon: typeof IconHome }[] = [
  { id: 'home', label: 'Home', Icon: IconHome },
  { id: 'discover', label: 'Discover', Icon: IconCompass },
  { id: 'library', label: 'Library', Icon: IconImage },
  { id: 'downloads', label: 'Downloads', Icon: IconDownload },
  { id: 'you', label: 'You', Icon: IconUser }
]

/**
 * Bottom navigation over the per-tab stacks. Tapping another tab switches to it
 * (its stack + scroll positions intact); re-tapping the active tab pops to its
 * root, or scrolls the root to the top.
 */
export default function TabBar(): React.JSX.Element {
  const { snapshot, switchTab, tapActiveTab } = useNav()

  return (
    <nav className="tabbar">
      {TABS.map(({ id, label, Icon }) => {
        const on = snapshot.active === id
        return (
          <button
            key={id}
            className={`tab ${on ? 'on' : ''}`}
            onClick={() => (on ? tapActiveTab() : switchTab(id))}
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
