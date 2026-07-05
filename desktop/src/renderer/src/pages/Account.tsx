import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useNotify } from '../context/notify'
import { useAuthed } from '../hooks/useAuthed'
import { formatCount } from '../lib/format'
import { readCache, writeCache } from '../lib/cache'
import type { UserProfile } from '@shared/types'

/** Account page — profile header card, blocked-tags editor, sign out. Requires auth. */
export default function Account(): JSX.Element {
  const notify = useNotify()
  const authed = useAuthed()
  // Paint the last-known profile instantly, then revalidate.
  const [profile, setProfile] = useState<UserProfile | null>(() => readCache<UserProfile>('me'))
  const [tag, setTag] = useState('')
  const [adding, setAdding] = useState(false)
  const [showSug, setShowSug] = useState(false)
  // Full tag catalog for autocomplete + "unknown tag" validation (cache-first).
  const [allTags, setAllTags] = useState<string[]>(() => readCache<string[]>('alltags') ?? [])

  const refetch = (): void => {
    window.api
      .getProfile()
      .then((p) => {
        setProfile(p)
        writeCache('me', p)
      })
      .catch((e) => notify('Couldn’t load profile: ' + e.message, 'error'))
  }

  // Fetch (or refresh) the profile whenever auth flips to signed-in — including
  // right after an in-app login while sitting on this page.
  useEffect(() => {
    if (authed) refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed])

  // Load the tag catalog once (thousands of tags; cached for instant reuse).
  useEffect(() => {
    window.api
      .getAllTags()
      .then((t) => {
        setAllTags(t)
        writeCache('alltags', t)
      })
      .catch(() => undefined)
  }, [])

  // RedGifs' JSON-patch "add" REPLACES the whole array, so every change must
  // send the complete desired blocked-tags list (and preferences alongside it),
  // otherwise adding one tag wipes the rest.
  const saveBlocked = (nextBlocked: string[]): void => {
    if (!profile || adding) return
    setAdding(true)
    window.api
      .updatePreferences([
        { op: 'add', path: '/preferences', value: profile.preferences },
        { op: 'add', path: '/blocked_tags', value: nextBlocked }
      ])
      .then(() => {
        notify('Updated', 'success')
        setTag('')
        setShowSug(false)
        refetch()
      })
      .catch((e) => notify('Update failed: ' + e.message, 'error'))
      .finally(() => setAdding(false))
  }

  const addTag = (raw?: string): void => {
    if (!profile) return
    const input = (raw ?? tag).trim()
    if (!input) return
    // Prefer the catalog's canonical casing when the tag is recognized.
    const known = allTags.find((x) => x.toLowerCase() === input.toLowerCase())
    const val = known ?? input
    if (profile.blockedTags.some((x) => x.toLowerCase() === val.toLowerCase())) {
      setTag('')
      return
    }
    saveBlocked([...profile.blockedTags, val])
  }

  const removeTag = (t: string): void => {
    if (!profile) return
    saveBlocked(profile.blockedTags.filter((x) => x !== t))
  }

  const q = tag.trim().toLowerCase()
  const suggestions = useMemo(() => {
    if (!q) return []
    const blocked = new Set((profile?.blockedTags ?? []).map((x) => x.toLowerCase()))
    return allTags
      .filter((t) => t.toLowerCase().includes(q) && !blocked.has(t.toLowerCase()))
      .slice(0, 8)
  }, [q, allTags, profile])
  // Whether the typed text matches a real tag (only judged once the catalog is in).
  const known = !q || allTags.length === 0 || allTags.some((t) => t.toLowerCase() === q)

  const signOut = (): void => {
    window.api
      .logout()
      .then(() => {
        // `useAuthed` flips to false via the auth-changed event.
        setProfile(null)
        notify('Signed out', 'success')
      })
      .catch((e) => notify('Sign out failed: ' + e.message, 'error'))
  }

  if (authed === false) {
    return (
      <div className="page">
        <PageHeader kicker="you" kickerIndex={10} title="Account" />
        <EmptyState
          message="Sign in to see this"
          hint="Your profile, stats, and preferences live behind your RedGifs account."
          action={
            <button className="btn btn-ember" onClick={() => window.api.login()}>
              Sign in
            </button>
          }
        />
      </div>
    )
  }

  const initial = (profile?.username || profile?.name || '?').trim().charAt(0).toUpperCase() || '?'

  const stats: Array<[number, string]> = profile
    ? [
        [profile.followers, 'followers'],
        [profile.following, 'following'],
        [profile.totalGifs, 'gifs'],
        [profile.views, 'views'],
        [profile.likes, 'likes']
      ]
    : []

  return (
    <div className="page">
      <PageHeader kicker="you" kickerIndex={10} title="Account" />

      {authed === null && <div style={loadingStyle}>Loading…</div>}

      {profile && (
        <>
          <div style={cardStyle}>
            <div style={avatarStyle}>
              {profile.profilePic ? (
                <img src={profile.profilePic} alt="" style={avatarImgStyle} />
              ) : (
                initial
              )}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={handleStyle}>@{profile.username}</div>
              {profile.name && <div style={nameStyle}>{profile.name}</div>}
              <div style={statRowStyle}>
                {stats.map(([n, label], i) => (
                  <span key={label} style={{ whiteSpace: 'nowrap' }}>
                    {i > 0 && <span style={dotStyle}>·</span>}
                    <span style={statNumStyle}>{formatCount(n)}</span> {label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <section style={{ marginTop: 30 }}>
            <div style={sectionLabelStyle}>Blocked tags</div>
            <p style={sectionHintStyle}>Add a tag to hide it from your feeds.</p>
            {profile.blockedTags.length > 0 && (
              <div style={chipRowStyle}>
                {profile.blockedTags.map((t) => (
                  <span key={t} style={chipStyle}>
                    {t}
                    <button
                      type="button"
                      aria-label={'Remove ' + t}
                      onClick={() => removeTag(t)}
                      style={chipRemoveStyle}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ maxWidth: 420 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input
                    style={{ width: '100%' }}
                    placeholder="Search tags to block…"
                    value={tag}
                    onChange={(e) => {
                      setTag(e.target.value)
                      setShowSug(true)
                    }}
                    onFocus={() => setShowSug(true)}
                    onBlur={() => setTimeout(() => setShowSug(false), 120)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addTag()
                      else if (e.key === 'Escape') setShowSug(false)
                    }}
                  />
                  {showSug && suggestions.length > 0 && (
                    <div style={sugBoxStyle}>
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          style={sugItemStyle}
                          // mousedown (not click) so it fires before the input's blur
                          onMouseDown={(e) => {
                            e.preventDefault()
                            addTag(s)
                          }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button className="btn btn-ember" onClick={() => addTag()} disabled={adding || !tag.trim()}>
                  {adding ? 'Adding…' : 'Add'}
                </button>
              </div>
              {!known && (
                <div style={unavailStyle}>
                  “{tag.trim()}” isn’t a known RedGifs tag — it may not block anything.
                </div>
              )}
            </div>
          </section>

          {profile.preferences.length > 0 && (
            <section style={{ marginTop: 34 }}>
              <div style={sectionLabelStyle}>Preferences</div>
              <p style={sectionHintStyle}>Content preferences from your RedGifs account.</p>
              <div style={chipRowStyle}>
                {profile.preferences.map((p) => (
                  <span key={p} style={chipStyle}>
                    {p}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section style={{ marginTop: 34 }}>
            <div style={sectionLabelStyle}>Session</div>
            <p style={sectionHintStyle}>
              Sign out and clear the stored RedGifs token from this device.
            </p>
            <button className="btn btn-danger" onClick={signOut}>
              Sign out
            </button>
          </section>
        </>
      )}
    </div>
  )
}

const loadingStyle: CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 12,
  letterSpacing: '0.04em',
  color: 'var(--dim)'
}

const cardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 22,
  padding: 22,
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  borderRadius: 14
}

const avatarStyle: CSSProperties = {
  width: 84,
  height: 84,
  flex: 'none',
  borderRadius: '50%',
  background: 'var(--line2)',
  color: 'var(--cream)',
  display: 'grid',
  placeItems: 'center',
  fontFamily: 'var(--serif)',
  fontSize: 34,
  fontWeight: 580,
  overflow: 'hidden'
}

const avatarImgStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover'
}

const handleStyle: CSSProperties = {
  fontFamily: 'var(--serif)',
  fontSize: 28,
  fontWeight: 560,
  color: 'var(--cream)',
  lineHeight: 1.1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const nameStyle: CSSProperties = {
  marginTop: 3,
  fontSize: 14,
  color: 'var(--mut)'
}

const statRowStyle: CSSProperties = {
  marginTop: 14,
  fontFamily: 'var(--mono)',
  fontSize: 11.5,
  letterSpacing: '0.03em',
  color: 'var(--mut)',
  display: 'flex',
  flexWrap: 'wrap',
  rowGap: 4
}

const statNumStyle: CSSProperties = {
  color: 'var(--ink)'
}

const dotStyle: CSSProperties = {
  color: 'var(--dim)',
  margin: '0 10px'
}

const sectionLabelStyle: CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ember)',
  marginBottom: 8
}

const sectionHintStyle: CSSProperties = {
  margin: '0 0 12px',
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--dim)',
  maxWidth: 520
}

const chipRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 14
}

const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'var(--mono)',
  fontSize: 12,
  letterSpacing: '0.03em',
  color: 'var(--ink)',
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  borderRadius: 999,
  padding: '4px 10px'
}

const chipRemoveStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  padding: 0,
  fontSize: 14,
  lineHeight: 1,
  color: 'var(--mut)',
  background: 'none',
  border: 'none',
  cursor: 'pointer'
}

const sugBoxStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  right: 0,
  zIndex: 20,
  maxHeight: 260,
  overflowY: 'auto',
  background: 'var(--panel)',
  border: '1px solid var(--line2)',
  borderRadius: 10,
  boxShadow: '0 18px 44px rgba(0, 0, 0, 0.5)',
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 2
}

const sugItemStyle: CSSProperties = {
  textAlign: 'left',
  background: 'none',
  border: 0,
  borderRadius: 7,
  padding: '7px 10px',
  fontSize: 13,
  color: 'var(--ink)',
  cursor: 'pointer',
  font: 'inherit'
}

const unavailStyle: CSSProperties = {
  marginTop: 8,
  fontFamily: 'var(--mono)',
  fontSize: 11,
  letterSpacing: '0.02em',
  color: 'var(--yellow, #d8a657)'
}
