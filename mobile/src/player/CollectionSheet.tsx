import { useEffect, useState } from 'react'
import type { Collection } from '@redloader/core'
import { api } from '../lib/api'
import { storage } from '../lib/storage'
import { useToast } from '../context/toast'
import { readCache, writeCache } from '../lib/cache'
import { emitCollectChange } from '../lib/collect'
import { IconBookmark } from '../components/icons'

interface CollectionSheetProps {
  contentId: string
  onClose: () => void
}

const CACHE_KEY = 'collections'

/**
 * Bottom-sheet add-to-collection picker. Opens instantly from the cached
 * collection list, then revalidates. Tapping a row toggles membership
 * OPTIMISTICALLY: the row flips at once, the API call runs in the background,
 * and a failure reverts it with a toast — the sheet never locks up waiting for
 * a slow network. "New collection" creates a folder AND files the gif into it.
 */
export default function CollectionSheet({ contentId, onClose }: CollectionSheetProps): React.JSX.Element {
  const notify = useToast()
  const [cols, setCols] = useState<Collection[] | null>(() => readCache<Collection[]>(CACHE_KEY))
  const [inIds, setInIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .getCollections()
      .then((list) => {
        if (alive) {
          setCols(list)
          writeCache(CACHE_KEY, list)
        }
      })
      .catch((e) => {
        if (alive && cols === null) {
          setCols([])
          notify('Couldn’t load collections: ' + (e instanceof Error ? e.message : String(e)), 'error')
        }
      })
    storage
      .gifCollectionIds(contentId)
      .then((ids) => {
        if (alive) setInIds(new Set(ids))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId])

  const setMember = (id: string, inside: boolean): void => {
    setInIds((prev) => {
      const next = new Set(prev)
      if (inside) next.add(id)
      else next.delete(id)
      emitCollectChange(contentId, next.size > 0)
      return next
    })
  }
  const mark = (id: string, on: boolean): void => {
    setBusy((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // Re-read membership from sqlite (the source of truth) after a mutation.
  const syncMembership = async (): Promise<void> => {
    const ids = await storage.gifCollectionIds(contentId)
    setInIds(new Set(ids))
    emitCollectChange(contentId, ids.length > 0)
  }

  const toggle = async (c: Collection): Promise<void> => {
    if (busy.has(c.id)) return
    const inside = inIds.has(c.id)
    const next = !inside
    mark(c.id, true)
    setMember(c.id, next) // optimistic
    try {
      if (next) {
        await api.addToCollection(c.id, contentId)
        await storage.addGifMembership(contentId, 'collection', c.id)
      } else {
        await api.removeFromCollection(c.id, contentId)
        await storage.removeGifMembership(contentId, 'collection', c.id)
      }
      await syncMembership()
      notify((next ? 'Added to ' : 'Removed from ') + c.name, 'success')
    } catch (e) {
      setMember(c.id, inside) // revert
      void syncMembership().catch(() => undefined)
      notify((next ? 'Add' : 'Remove') + ' failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      mark(c.id, false)
    }
  }

  const create = async (): Promise<void> => {
    const n = name.trim()
    if (!n || saving) return
    setSaving(true)
    try {
      await api.createCollection(n)
      const list = await api.getCollections()
      setCols(list)
      writeCache(CACHE_KEY, list)
      const made = list.find((c) => c.name === n)
      if (made) {
        setMember(made.id, true)
        await api.addToCollection(made.id, contentId)
        await storage.addGifMembership(contentId, 'collection', made.id)
        await syncMembership()
        notify('Added to ' + n, 'success')
      } else {
        notify('Created ' + n, 'success')
      }
      setName('')
      setCreating(false)
    } catch (e) {
      void syncMembership().catch(() => undefined)
      notify('Create failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        {cols === null ? (
          <div className="loading">Loading…</div>
        ) : (
          <>
            {cols.map((c) => {
              const inside = inIds.has(c.id)
              const working = busy.has(c.id)
              return (
                <button
                  key={c.id}
                  className={`sheet-row ${inside ? 'on' : ''} ${working ? 'busy' : ''}`}
                  aria-pressed={inside}
                  onClick={() => void toggle(c)}
                >
                  <IconBookmark style={inside ? { color: 'var(--ember)', fill: 'var(--ember)' } : undefined} />
                  <span style={{ flex: 1 }}>{c.name}</span>
                  {inside && <span className="pill pill-ok">in</span>}
                </button>
              )
            })}
            {creating ? (
              <div style={{ display: 'flex', gap: 8, padding: '10px 4px' }}>
                <input
                  className="search"
                  autoFocus
                  placeholder="Collection name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void create()
                  }}
                />
                <button className="btn btn-ember btn-sm" disabled={saving || !name.trim()} onClick={() => void create()}>
                  {saving ? '…' : 'Add'}
                </button>
              </div>
            ) : (
              <button className="sheet-row" onClick={() => setCreating(true)}>
                <IconBookmark />
                <span>New collection…</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
