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
 * collection list, then revalidates. Tapping a row toggles membership;
 * "New collection" creates a folder AND files the gif into it.
 */
export default function CollectionSheet({ contentId, onClose }: CollectionSheetProps): React.JSX.Element {
  const notify = useToast()
  const [cols, setCols] = useState<Collection[] | null>(() => readCache<Collection[]>(CACHE_KEY))
  const [inIds, setInIds] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
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

  // Re-read membership from sqlite (the source of truth) after every mutation
  // instead of mutating a Set captured from the render closure — that avoids a
  // stale-closure clobber if a create() resolves in between.
  const syncMembership = async (): Promise<void> => {
    const ids = await storage.gifCollectionIds(contentId)
    setInIds(new Set(ids))
    emitCollectChange(contentId, ids.length > 0)
  }

  const toggle = async (c: Collection): Promise<void> => {
    if (busyId || saving) return
    setBusyId(c.id)
    const inside = inIds.has(c.id)
    try {
      if (inside) {
        await api.removeFromCollection(c.id, contentId)
        await storage.removeGifMembership(contentId, 'collection', c.id)
        await syncMembership()
        notify('Removed from ' + c.name, 'success')
      } else {
        await api.addToCollection(c.id, contentId)
        await storage.addGifMembership(contentId, 'collection', c.id)
        await syncMembership()
        notify('Added to ' + c.name, 'success')
      }
    } catch (e) {
      notify('Failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setBusyId(null)
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
            {cols.map((c) => (
              <button key={c.id} className="sheet-row" disabled={busyId !== null || saving} onClick={() => void toggle(c)}>
                <IconBookmark style={inIds.has(c.id) ? { color: 'var(--ember)' } : undefined} />
                <span style={{ flex: 1 }}>{busyId === c.id ? '…' : c.name}</span>
                {inIds.has(c.id) && <span className="pill pill-ok">in</span>}
              </button>
            ))}
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
