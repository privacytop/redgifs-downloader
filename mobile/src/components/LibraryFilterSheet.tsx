import { useEffect, useState } from 'react'
import type { Collection } from '@redloader/core'
import { storage, type TagCount } from '../lib/storage'
import { formatCount } from '../lib/format'
import { useDebounced } from '../hooks/useDebounced'
import { IconCheck } from './icons'

/** Everything in the Library filter sheet except free text + sort. */
export interface LibraryFilters {
  tags: string[]
  tagMode: 'all' | 'any'
  collections: string[]
  likedOnly: boolean
  creator: string
  minViews: number
  minLikes: number
  minDuration: number
}

export const EMPTY_FILTERS: LibraryFilters = {
  tags: [],
  tagMode: 'all',
  collections: [],
  likedOnly: false,
  creator: '',
  minViews: 0,
  minLikes: 0,
  minDuration: 0
}

export function countActiveFilters(f: LibraryFilters): number {
  return (
    f.tags.length +
    f.collections.length +
    (f.likedOnly ? 1 : 0) +
    (f.creator.trim() ? 1 : 0) +
    (f.minViews ? 1 : 0) +
    (f.minLikes ? 1 : 0) +
    (f.minDuration ? 1 : 0)
  )
}

const VIEWS = [0, 1_000, 10_000, 100_000, 1_000_000]
const LIKES = [0, 100, 1_000, 10_000]
const LENGTHS: Array<[number, string]> = [[0, 'Any'], [10, '10s+'], [30, '30s+'], [60, '1m+'], [180, '3m+']]

interface Props {
  filters: LibraryFilters
  onChange: (next: LibraryFilters) => void
  onClose: () => void
  collections: Collection[]
}

/**
 * Bottom sheet composing a structured offline-library query: collections
 * (any of), liked, tags (all / any, with a search over the index's own tags),
 * minimum views / likes / length, creator. Every change applies live — the
 * grid behind the sheet updates as you tap.
 */
export default function LibraryFilterSheet({ filters, onChange, onClose, collections }: Props): React.JSX.Element {
  const [tagQuery, setTagQuery] = useState('')
  const q = useDebounced(tagQuery, 150)
  const [tags, setTags] = useState<TagCount[]>([])

  useEffect(() => {
    let live = true
    storage
      .libraryTags(40, q)
      .then((t) => live && setTags(t))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [q])

  const set = <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]): void =>
    onChange({ ...filters, [key]: value })
  const toggleIn = (key: 'tags' | 'collections', value: string): void => {
    const cur = filters[key]
    set(key, cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value])
  }

  // Selected tags that aren't in the current suggestion list still need a chip.
  const shownTags: TagCount[] = [
    ...filters.tags
      .filter((t) => !tags.some((x) => x.tag === t))
      .map((t) => ({ tag: t, label: t, count: 0 })),
    ...tags
  ]

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sheet-tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div className="sheet-title">Filter library</div>
          <button className="btn btn-sm" onClick={() => onChange(EMPTY_FILTERS)} disabled={countActiveFilters(filters) === 0}>
            Reset
          </button>
          <button className="btn btn-sm btn-ember" onClick={onClose}>Done</button>
        </div>

        <div className="section-label">Collections <span className="section-hint">any of</span></div>
        <div className="chip-row">
          <button className={`chip ${filters.likedOnly ? 'on' : ''}`} onClick={() => set('likedOnly', !filters.likedOnly)}>
            Liked
          </button>
          {collections.map((c) => (
            <button
              key={c.id}
              className={`chip ${filters.collections.includes(c.id) ? 'on' : ''}`}
              onClick={() => toggleIn('collections', c.id)}
            >
              {c.name}
            </button>
          ))}
          {collections.length === 0 && <span className="readout">No collections loaded</span>}
        </div>

        <div className="section-label" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          Tags
          <div className="seg seg-mini" role="group" aria-label="Tag mode">
            <button className={filters.tagMode === 'all' ? 'on' : ''} onClick={() => set('tagMode', 'all')}>All</button>
            <button className={filters.tagMode === 'any' ? 'on' : ''} onClick={() => set('tagMode', 'any')}>Any</button>
          </div>
        </div>
        <input
          className="search"
          placeholder="Find a tag in your library…"
          value={tagQuery}
          onChange={(e) => setTagQuery(e.target.value)}
        />
        <div className="chip-row" style={{ marginTop: 10 }}>
          {shownTags.map((t) => {
            const on = filters.tags.includes(t.tag)
            return (
              <button key={t.tag} className={`chip chip-count ${on ? 'on' : ''}`} onClick={() => toggleIn('tags', t.tag)}>
                {on && <IconCheck style={{ width: 11, height: 11 }} />}
                {t.label}
                {t.count > 0 && <span className="chip-n">{formatCount(t.count)}</span>}
              </button>
            )
          })}
          {shownTags.length === 0 && <span className="readout">No tags match</span>}
        </div>

        <div className="section-label">Minimum views</div>
        <div className="chip-row">
          {VIEWS.map((v) => (
            <button key={v} className={`chip ${filters.minViews === v ? 'on' : ''}`} onClick={() => set('minViews', v)}>
              {v === 0 ? 'Any' : `${formatCount(v)}+`}
            </button>
          ))}
        </div>

        <div className="section-label">Minimum likes</div>
        <div className="chip-row">
          {LIKES.map((v) => (
            <button key={v} className={`chip ${filters.minLikes === v ? 'on' : ''}`} onClick={() => set('minLikes', v)}>
              {v === 0 ? 'Any' : `${formatCount(v)}+`}
            </button>
          ))}
        </div>

        <div className="section-label">Minimum length</div>
        <div className="chip-row">
          {LENGTHS.map(([v, label]) => (
            <button key={v} className={`chip ${filters.minDuration === v ? 'on' : ''}`} onClick={() => set('minDuration', v)}>
              {label}
            </button>
          ))}
        </div>

        <div className="section-label">Creator</div>
        <input
          className="search"
          placeholder="Exact @username"
          value={filters.creator}
          onChange={(e) => set('creator', e.target.value.replace(/^@/, ''))}
        />
        <div style={{ height: 8 }} />
      </div>
    </div>
  )
}
