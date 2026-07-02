import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Collection } from '@shared/types'
import { useNotify } from '../context/notify'

interface CollectionMenuProps {
  /** Gif id being added. */
  contentId: string
  /** Dismiss the popover. */
  onClose: () => void
}

// Midnight Press inline styles (tokens.css is off-limits for this task).
const panelStyle: CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 8px)',
  right: 0,
  zIndex: 6,
  width: 240,
  maxHeight: 300,
  overflowY: 'auto',
  background: 'var(--panel)',
  border: '1px solid var(--line2)',
  borderRadius: 'var(--radius)',
  boxShadow: '0 18px 50px rgba(0, 0, 0, 0.6)',
  padding: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 2
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 0,
  borderRadius: 7,
  padding: '8px 10px',
  color: 'var(--ink)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 13
}

const countStyle: CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 10,
  letterSpacing: '0.04em',
  color: 'var(--dim)',
  flex: 'none'
}

const labelStyle: CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.16em',
  color: 'var(--dim)',
  padding: '6px 10px 4px'
}

const hintStyle: CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  letterSpacing: '0.03em',
  color: 'var(--mut)',
  padding: '10px 10px 12px',
  lineHeight: 1.5
}

/**
 * Popover listing the user's collections. Clicking one adds the current gif;
 * a "New collection…" row reveals an inline input that creates + refreshes.
 * Requires auth — degrades to a hint when the list can't load or is empty.
 */
export default function CollectionMenu({ contentId, onClose }: CollectionMenuProps): JSX.Element {
  const notify = useNotify()

  const [collections, setCollections] = useState<Collection[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = async (): Promise<void> => {
    try {
      const list = await window.api.getCollections()
      setCollections(list)
      setFailed(false)
    } catch {
      setCollections([])
      setFailed(true)
    }
  }

  // Load once on mount.
  useEffect(() => {
    void load()
  }, [])

  // Dismiss on outside click or Esc. Stop Esc from also closing the player.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  // Focus the input when the create row appears.
  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  const add = async (c: Collection): Promise<void> => {
    if (busyId) return
    setBusyId(c.id)
    try {
      await window.api.addToCollection(c.id, contentId)
      notify('Added to ' + c.name, 'success')
      onClose()
    } catch (e) {
      notify('Add failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
      setBusyId(null)
    }
  }

  const create = async (): Promise<void> => {
    const name = newName.trim()
    if (!name || saving) return
    setSaving(true)
    try {
      await window.api.createCollection(name)
      notify('Created ' + name, 'success')
      setNewName('')
      setCreating(false)
      await load()
    } catch (e) {
      notify('Create failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      ref={rootRef}
      style={panelStyle}
      role="menu"
      aria-label="Add to collection"
      onWheel={(e) => e.stopPropagation()}
    >
      <div style={labelStyle}>add to collection</div>

      {collections === null ? (
        <div style={hintStyle}>Loading…</div>
      ) : failed ? (
        <div style={hintStyle}>Sign in to use collections.</div>
      ) : collections.length === 0 ? (
        <div style={hintStyle}>No collections yet — create one below.</div>
      ) : (
        collections.map((c) => (
          <button
            key={c.id}
            type="button"
            role="menuitem"
            style={rowStyle}
            disabled={busyId !== null}
            onClick={() => void add(c)}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'none'
            }}
          >
            <span
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {busyId === c.id ? 'Adding…' : c.name}
            </span>
            <span style={countStyle}>{c.contentCount}</span>
          </button>
        ))
      )}

      {creating ? (
        <div style={{ display: 'flex', gap: 6, padding: '6px 6px 4px' }}>
          <input
            ref={inputRef}
            style={{ flex: 1, minWidth: 0, fontSize: 13, padding: '7px 9px' }}
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
            {saving ? '…' : 'Add'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          role="menuitem"
          style={{ ...rowStyle, color: 'var(--ember)' }}
          onClick={() => setCreating(true)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'none'
          }}
        >
          <span>+ New collection…</span>
        </button>
      )}
    </div>
  )
}
