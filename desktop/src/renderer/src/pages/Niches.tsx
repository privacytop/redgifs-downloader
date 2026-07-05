import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
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
    <button
      onClick={() => onOpen(niche)}
      style={{
        display: 'block',
        textAlign: 'left',
        width: '100%',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: 14,
        color: 'var(--ink)',
        cursor: 'pointer'
      }}
    >
      {niche.thumbnail && (
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '16 / 9',
            borderRadius: 8,
            overflow: 'hidden',
            marginBottom: 10,
            background: 'var(--bg)',
            border: '1px solid var(--line2)'
          }}
        >
          <img
            src={niche.thumbnail}
            alt=""
            loading="lazy"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      )}
      <div style={{ fontFamily: 'Fraunces, serif', fontSize: 17, color: 'var(--cream)', lineHeight: 1.2 }}>
        {niche.name}
      </div>
      <div
        style={{
          fontFamily: '"Space Mono", monospace',
          fontSize: 11,
          color: 'var(--mut)',
          marginTop: 6,
          letterSpacing: '0.02em'
        }}
      >
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
    <button
      onClick={() => onOpen(name)}
      style={{
        display: 'block',
        textAlign: 'left',
        width: '100%',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: 14,
        color: 'var(--ink)',
        cursor: 'pointer'
      }}
    >
      <div style={{ fontFamily: 'Fraunces, serif', fontSize: 17, color: 'var(--cream)', lineHeight: 1.2 }}>
        {name}
      </div>
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
        <EmptyState
          message="Sign in to see this"
          hint="Your niches sync once you connect a RedGifs account."
          action={
            <button className="btn btn-ember" onClick={() => window.api.login()}>
              Sign in
            </button>
          }
        />
      ) : error ? (
        <EmptyState message="Couldn't load niches" hint={error} />
      ) : rows.length === 0 && !loading ? (
        <EmptyState message="No niches here yet" />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 14
          }}
        >
          {isCategories
            ? (rows as string[])
                .filter((c): c is string => typeof c === 'string')
                .map((c) => <CategoryCard key={c} name={c} onOpen={openCategory} />)
            : (rows as Niche[])
                .filter((n): n is Niche => typeof n === 'object' && n !== null)
                .map((n) => <NicheCard key={n.id} niche={n} onOpen={openNiche} />)}
        </div>
      )}

      {loading && rows.length === 0 && !gated && !error && (
        <div
          style={{
            fontFamily: '"Space Mono", monospace',
            fontSize: 12,
            color: 'var(--dim)',
            textAlign: 'center',
            marginTop: 24
          }}
        >
          Loading…
        </div>
      )}
    </div>
  )
}
