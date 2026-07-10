import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Collection } from '@shared/types'
import { useNotify } from '../context/notify'
import { readCache, writeCache } from '../lib/cache'
import { useLocalFlag } from '../hooks/useLocalFlag'

// Same key the Collections page (useCachedResource) uses — one shared copy, so
// the menu opens instantly with known names and a folder created here shows up
// on the page (and vice versa) without a refetch.
const COLLECTIONS_CACHE_KEY = 'collections'

/** Viewport rect of the trigger button, captured at open time. */
export interface MenuAnchor {
  top: number
  bottom: number
  left: number
  right: number
}

interface CollectionMenuProps {
  /** Gif id being added. */
  contentId: string
  /** Dismiss the popover. */
  onClose: () => void
  /**
   * Where to anchor the panel. The player rail scrolls (`overflow-y: auto`),
   * which clips absolutely-positioned descendants — so the panel positions
   * itself `fixed` right under (or above) the trigger instead.
   */
  anchor?: MenuAnchor
}

const PANEL_WIDTH = 262
const PANEL_MAX_HEIGHT = 340
const GAP = 8

/** Fixed placement under the anchor, flipping above when space runs out. */
function anchoredStyle(anchor?: MenuAnchor): CSSProperties {
  if (!anchor) return {}
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.min(Math.max(GAP, anchor.right - PANEL_WIDTH), vw - PANEL_WIDTH - GAP)
  const spaceBelow = vh - anchor.bottom - GAP * 2
  if (spaceBelow >= 240 || spaceBelow >= anchor.top - GAP * 2) {
    return {
      position: 'fixed',
      left,
      top: anchor.bottom + GAP,
      right: 'auto',
      bottom: 'auto',
      maxHeight: Math.min(PANEL_MAX_HEIGHT, spaceBelow)
    }
  }
  return {
    position: 'fixed',
    left,
    bottom: vh - anchor.top + GAP,
    top: 'auto',
    right: 'auto',
    maxHeight: Math.min(PANEL_MAX_HEIGHT, anchor.top - GAP * 2)
  }
}

/**
 * Broadcast a collection membership change so any open view of that collection
 * (e.g. CollectionDetail) can refresh without the user reopening it.
 */
function emitCollectionChange(folderId: string, gifId: string, action: 'add' | 'remove'): void {
  window.dispatchEvent(new CustomEvent('rgd:collection-changed', { detail: { folderId, gifId, action } }))
}

/**
 * Popover listing the user's collections. Clicking one toggles membership of
 * the current gif; "New collection…" reveals an inline input that creates the
 * folder AND files the gif into it — one gesture, one toast.
 * Anchored to its trigger via `.menu-panel`; outside clicks and Escape close.
 */
export default function CollectionMenu({ contentId, onClose, anchor }: CollectionMenuProps): JSX.Element {
  const notify = useNotify()

  // Stale-while-revalidate: paint cached names immediately (no "Loading…"
  // flash on every open), refresh in the background.
  const [collections, setCollections] = useState<Collection[] | null>(() =>
    readCache<Collection[]>(COLLECTIONS_CACHE_KEY)
  )
  const [inIds, setInIds] = useState<Set<string>>(new Set())
  // Two distinct failure states: signed out gets the auth hint, everything
  // else gets the real error + retry. Blaming auth for a network blip lies.
  const [signedOut, setSignedOut] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  // Cover thumbnails per row — user-toggleable in Settings → Appearance.
  const [previews] = useLocalFlag('collectionPreviews', true)
  const [brokenThumbs, setBrokenThumbs] = useState<ReadonlySet<string>>(new Set())

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Latest list without stale closures — a background-refresh failure over
  // cached rows should stay quiet instead of replacing them with an error.
  const collectionsRef = useRef(collections)
  collectionsRef.current = collections

  const load = async (): Promise<void> => {
    // Membership is per-gif and can't be cached ahead — fetch it independently
    // so the (possibly cached) rows never wait on it; pills fill in when ready.
    window.api
      .gifCollections(contentId)
      .then((ids) => setInIds(new Set(ids)))
      .catch(() => {
        /* rows still work; membership pills just stay unknown */
      })
    try {
      const list = await window.api.getCollections()
      setCollections(list)
      writeCache(COLLECTIONS_CACHE_KEY, list)
      setSignedOut(false)
      setLoadError(null)
    } catch (e) {
      // Cached rows on screen → fail silently; the menu still works.
      if (collectionsRef.current && collectionsRef.current.length > 0) return
      const authed = await window.api
        .authStatus()
        .then((s) => s.authenticated)
        .catch(() => false)
      setCollections([])
      setSignedOut(!authed)
      setLoadError(authed ? (e instanceof Error ? e.message : String(e)) : null)
    }
  }

  // Load once on mount.
  useEffect(() => {
    void load()
  }, [])

  // Keyboard while open: Esc closes (captured so the player's own Esc handler
  // never sees it and closes the whole overlay), ArrowUp/Down rove focus over
  // the row buttons (also captured, so the player doesn't step clips).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      // Leave arrows alone while typing a collection name.
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return
      const rows = Array.from(
        rootRef.current?.querySelectorAll<HTMLButtonElement>('.menu-row:not(:disabled)') ?? []
      )
      if (rows.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      const i = rows.indexOf(document.activeElement as HTMLButtonElement)
      const next =
        e.key === 'ArrowDown'
          ? i < 0
            ? 0
            : (i + 1) % rows.length
          : i < 0
            ? rows.length - 1
            : (i - 1 + rows.length) % rows.length
      rows[next].focus()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Outside clicks close and are swallowed (capture phase), matching the old
  // backdrop: the first click dismisses the menu instead of also re-toggling
  // the trigger or activating whatever else was underneath.
  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('click', onDocClick, true)
    return () => document.removeEventListener('click', onDocClick, true)
  }, [onClose])

  // Focus the input when the create row appears.
  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  // A fixed panel doesn't follow its trigger — close when anything outside the
  // panel scrolls (e.g. the rail) rather than drifting away from the button.
  useEffect(() => {
    if (!anchor) return
    const onScroll = (e: Event): void => {
      if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) return
      onClose()
    }
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [anchor, onClose])

  const add = async (c: Collection): Promise<void> => {
    if (busyId || inIds.has(c.id)) return
    setBusyId(c.id)
    try {
      await window.api.addToCollection(c.id, contentId)
      setInIds((prev) => new Set(prev).add(c.id))
      emitCollectionChange(c.id, contentId, 'add')
      notify('Added to ' + c.name, 'success')
    } catch (e) {
      notify('Add failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (c: Collection): Promise<void> => {
    if (busyId) return
    setBusyId(c.id)
    try {
      await window.api.removeFromCollection(c.id, contentId)
      setInIds((prev) => {
        const next = new Set(prev)
        next.delete(c.id)
        return next
      })
      emitCollectionChange(c.id, contentId, 'remove')
      notify('Removed from ' + c.name, 'success')
    } catch (e) {
      notify('Remove failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setBusyId(null)
    }
  }

  // Clicking a row toggles membership: adds if absent, removes if already in.
  const toggle = (c: Collection): void => void (inIds.has(c.id) ? remove(c) : add(c))

  const create = async (): Promise<void> => {
    const name = newName.trim()
    if (!name || saving) return
    setSaving(true)
    try {
      await window.api.createCollection(name)
      // createCollection returns no id, so refetch and match by name — the
      // user's intent was "save THIS gif into a new folder", not just "make
      // an empty folder", so finish the whole gesture here. The refreshed
      // list goes into the shared cache so the Collections page and the next
      // menu open see the new folder immediately.
      const list = await window.api.getCollections()
      setCollections(list)
      writeCache(COLLECTIONS_CACHE_KEY, list)
      const created = list.find((c) => c.name === name)
      if (created) {
        await window.api.addToCollection(created.id, contentId)
        setInIds((prev) => new Set(prev).add(created.id))
        emitCollectionChange(created.id, contentId, 'add')
        notify('Added to ' + name, 'success')
      } else {
        // Folder exists but we couldn't spot it in the refetch — still created.
        notify('Created ' + name, 'success')
      }
      setNewName('')
      setCreating(false)
    } catch (e) {
      notify('Create failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setSaving(false)
    }
  }

  const retry = (): void => {
    setCollections(null)
    setLoadError(null)
    void load()
  }

  return (
    <div
      ref={rootRef}
      className="menu-panel"
      style={anchoredStyle(anchor)}
      aria-label="Add to collection"
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="menu-label">Add to collection</div>

      {collections === null ? (
        <div className="menu-hint">Loading…</div>
      ) : signedOut ? (
        <div className="menu-hint">Sign in to use collections.</div>
      ) : loadError ? (
        <>
          <div className="menu-hint">Couldn’t load collections: {loadError}</div>
          <button type="button" className="btn btn-sm" onClick={retry}>
            Try again
          </button>
        </>
      ) : collections.length === 0 ? (
        <div className="menu-hint">No collections yet — create one below.</div>
      ) : (
        collections.map((c) => (
          <button
            key={c.id}
            type="button"
            className="menu-row"
            disabled={busyId !== null}
            onClick={() => toggle(c)}
          >
            {previews &&
              (c.thumbnailUrl && !brokenThumbs.has(c.id) ? (
                <img
                  className="menu-thumb"
                  src={c.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  onError={() => setBrokenThumbs((prev) => new Set(prev).add(c.id))}
                />
              ) : (
                // Cover URL missing or expired — hold the slot so rows align.
                <span className="menu-thumb" aria-hidden="true" />
              ))}
            <span className="list-main list-title">
              {busyId === c.id ? (inIds.has(c.id) ? 'Removing…' : 'Adding…') : c.name}
            </span>
            {inIds.has(c.id) ? (
              <span className="pill pill-ok" title="Click to remove from this collection">
                in
              </span>
            ) : (
              <span className="readout">{c.contentCount}</span>
            )}
          </button>
        ))
      )}

      <hr className="menu-sep" />

      {creating ? (
        <div className="field">
          <input
            ref={inputRef}
            placeholder="Collection name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void create()
              }
            }}
          />
          <button
            type="button"
            className="btn btn-ember btn-sm"
            disabled={saving || !newName.trim()}
            onClick={() => void create()}
          >
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      ) : (
        <button type="button" className="menu-row" onClick={() => setCreating(true)}>
          + New collection…
        </button>
      )}
    </div>
  )
}
