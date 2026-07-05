import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import FeedState from '../components/FeedState'
import SignInGate from '../components/SignInGate'
import { useNav } from '../context/nav'
import { useCachedResource } from '../hooks/useCachedResource'
import { useAuthed } from '../hooks/useAuthed'
import { formatCount } from '../lib/format'
import type { Niche } from '@shared/types'

type Tab = 'trending' | 'categories' | 'my' | 'following'

interface TabDef {
  key: Tab
  label: string
  needsAuth: boolean
  // `categories` resolves to bare category-name strings (the live
  // /niches/categories endpoint returns `{ categories: string[] }`); every
  // other tab resolves to full niche objects.
  fetch: () => Promise<Niche[] | string[]>
}

const TABS: TabDef[] = [
  { key: 'trending', label: 'Trending', needsAuth: false, fetch: () => window.api.getNichesTrending() },
  { key: 'categories', label: 'Categories', needsAuth: false, fetch: () => window.api.getNicheCategories() },
  { key: 'my', label: 'My', needsAuth: true, fetch: () => window.api.getMyNiches() },
  { key: 'following', label: 'Following', needsAuth: true, fetch: () => window.api.getFollowingNiches() }
]

function NicheCard({ niche, onOpen }: { niche: Niche; onOpen: (n: Niche) => void }): JSX.Element {
  return (
    <button className="tile" onClick={() => onOpen(niche)}>
      {niche.thumbnail && (
        <div className="tile-cover ar-16-9">
          <img src={niche.thumbnail} alt="" loading="lazy" />
        </div>
      )}
      <div className="tile-title">{niche.name}</div>
      <div className="tile-sub">
        {formatCount(niche.subscribers)} subs · {formatCount(niche.gifs)} gifs
      </div>
    </button>
  )
}

function CategoryCard({
  name,
  onOpen
}: {
  name: string
  onOpen: (name: string) => void
}): JSX.Element {
  return (
    <button className="tile" onClick={() => onOpen(name)}>
      <div className="tile-title">{name}</div>
    </button>
  )
}

export default function Niches(): JSX.Element {
  const { navigate } = useNav()
  const [tab, setTab] = useState<Tab>('trending')
  const authed = useAuthed() === true

  const active = TABS.find((t) => t.key === tab)!
  const gated = active.needsAuth && !authed

  // Cache-first per tab: show the last-known list instantly, then revalidate.
  const { data, loading, error } = useCachedResource<Niche[] | string[]>(
    `niches:${tab}`,
    () => (gated ? Promise.resolve([] as Niche[]) : active.fetch()),
    [tab, authed]
  )
  const rows: Niche[] | string[] = gated ? [] : (data ?? [])

  const openNiche = (n: Niche): void => navigate({ name: 'niche', id: n.id, title: n.name })
  const openCategory = (name: string): void => navigate({ name: 'tag', tag: name })
  const isCategories = tab === 'categories'

  return (
    <div className="page">
      <PageHeader
        kicker="niches"
        kickerIndex={4}
        title="Niches"
        right={
          <div className="seg">
            {TABS.map((t) => (
              <button key={t.key} className={t.key === tab ? 'on' : ''} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      {gated ? (
        <SignInGate
          message="Sign in to see this"
          hint="Your niches sync once you connect a RedGifs account."
        />
      ) : (
        <>
          <FeedState
            loading={loading}
            error={error}
            isEmpty={rows.length === 0}
            emptyMessage="No niches here yet"
            skeleton="grid"
          />
          <div className="tile-grid">
            {isCategories
              ? (rows as string[])
                  .filter((c): c is string => typeof c === 'string')
                  .map((c) => <CategoryCard key={c} name={c} onOpen={openCategory} />)
              : (rows as Niche[])
                  .filter((n): n is Niche => typeof n === 'object' && n !== null)
                  .map((n) => <NicheCard key={n.id} niche={n} onOpen={openNiche} />)}
          </div>
        </>
      )}
    </div>
  )
}
