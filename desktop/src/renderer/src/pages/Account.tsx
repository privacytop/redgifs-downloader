import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import SignInGate from '../components/SignInGate'
import ConfirmDialog from '../components/ConfirmDialog'
import { useNotify } from '../context/notify'
import { useAuthed } from '../hooks/useAuthed'
import { formatCount } from '../lib/format'
import { readCache, writeCache } from '../lib/cache'
import type { UserProfile } from '@shared/types'

/** Account page — profile hero, blocked-tags editor, sign out. Requires auth. */
export default function Account(): JSX.Element {
  const notify = useNotify()
  const authed = useAuthed()
  // Paint the last-known profile instantly, then revalidate.
  const [profile, setProfile] = useState<UserProfile | null>(() => readCache<UserProfile>('me'))
  const [error, setError] = useState<string | null>(null)
  const [tag, setTag] = useState('')
  const [saving, setSaving] = useState(false)
  const [showSug, setShowSug] = useState(false)
  const [activeSug, setActiveSug] = useState(-1)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  // Full tag catalog for autocomplete + "unknown tag" validation (cache-first).
  const [allTags, setAllTags] = useState<string[]>(() => readCache<string[]>('alltags') ?? [])
  // Saves run through a serialized chain (see saveBlocked); the ref tracks the
  // freshest known blocked list so queued edits apply on top of earlier ones.
  const saveChain = useRef<Promise<void>>(Promise.resolve())
  const savesInFlight = useRef(0)
  const blockedRef = useRef<string[]>(profile?.blockedTags ?? [])

  // Generation-guarded: a slow GET issued before a later one (or before a
  // save's reconcile) must not land on top of fresher data.
  const refetchGen = useRef(0)
  const refetch = (): void => {
    const gen = ++refetchGen.current
    window.api
      .getProfile()
      .then((p) => {
        if (gen !== refetchGen.current) return
        setProfile(p)
        setError(null)
        writeCache('me', p)
      })
      .catch((e) => {
        if (gen !== refetchGen.current) return
        setError(e.message)
        notify('Couldn’t load profile: ' + e.message, 'error')
      })
  }

  // Fetch (or refresh) the profile whenever auth flips to signed-in — including
  // right after an in-app login while sitting on this page.
  useEffect(() => {
    if (authed) refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed])

  // Server truth wins whenever a fresh profile lands — but never mid-save: a
  // GET read before an in-flight PATCH would roll the list back and make the
  // next queued transform resurrect (or drop) tags on the server.
  useEffect(() => {
    if (profile && savesInFlight.current === 0) blockedRef.current = profile.blockedTags
  }, [profile])

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
  // otherwise adding one tag wipes the rest. Edits are expressed as transforms
  // and serialized through a promise chain: a remove issued while another save
  // is in flight queues behind it (recomputed against the list that save
  // produced) instead of being dropped.
  const saveBlocked = (transform: (current: string[]) => string[]): void => {
    if (!profile) return
    const prefs = profile.preferences
    savesInFlight.current += 1
    setSaving(true)
    saveChain.current = saveChain.current
      .then(async () => {
        const next = transform(blockedRef.current)
        await window.api.updatePreferences([
          { op: 'add', path: '/preferences', value: prefs },
          { op: 'add', path: '/blocked_tags', value: next }
        ])
        blockedRef.current = next
        notify('Updated', 'success')
        setTag('')
        setShowSug(false)
        setActiveSug(-1)
      })
      .catch((e) => notify('Update failed: ' + (e as Error).message, 'error'))
      .finally(() => {
        savesInFlight.current -= 1
        if (savesInFlight.current === 0) {
          setSaving(false)
          // Reconcile with the server only once the chain has drained — a
          // refetch racing a queued PATCH could return a pre-PATCH snapshot.
          refetch()
        }
      })
  }

  const addTag = (raw?: string): void => {
    if (!profile) return
    const input = (raw ?? tag).trim()
    if (!input) return
    // Prefer the catalog's canonical casing when the tag is recognized.
    const known = allTags.find((x) => x.toLowerCase() === input.toLowerCase())
    const val = known ?? input
    if (blockedRef.current.some((x) => x.toLowerCase() === val.toLowerCase())) {
      setTag('')
      return
    }
    // Dedupe again at execution time — a queued edit may already have added it.
    saveBlocked((cur) =>
      cur.some((x) => x.toLowerCase() === val.toLowerCase()) ? cur : [...cur, val]
    )
  }

  const removeTag = (t: string): void => {
    saveBlocked((cur) => cur.filter((x) => x !== t))
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
  const sugOpen = showSug && suggestions.length > 0

  const onTagKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setShowSug(true)
      setActiveSug((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveSug((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      // Enter picks the highlighted suggestion; with none active it submits
      // the typed text as-is.
      if (sugOpen && activeSug >= 0 && activeSug < suggestions.length) addTag(suggestions[activeSug])
      else addTag()
    } else if (e.key === 'Escape') {
      setShowSug(false)
      setActiveSug(-1)
    }
  }

  const signOut = (): void => {
    setConfirmSignOut(false)
    setSigningOut(true)
    window.api
      .logout()
      .then(() => {
        // `useAuthed` flips to false via the auth-changed event.
        setProfile(null)
        notify('Signed out', 'success')
      })
      .catch((e) => notify('Sign out failed: ' + (e as Error).message, 'error'))
      .finally(() => setSigningOut(false))
  }

  if (authed === false) {
    return (
      <div className="page">
        <PageHeader kicker="you" kickerIndex={10} title="Account" />
        <SignInGate
          message="Sign in to see this"
          hint="Your profile, stats, and preferences live behind your RedGifs account."
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
      <PageHeader
        kicker="you"
        kickerIndex={10}
        title="Account"
        right={
          authed ? (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => setConfirmSignOut(true)}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          ) : undefined
        }
      />

      {!profile && !error && <div className="readout">Loading…</div>}

      {/* Surface a failed load when we have nothing cached to fall back on. */}
      {!profile && error && (
        <EmptyState
          message="Couldn’t load your account"
          hint={error}
          action={
            <button className="btn" onClick={refetch}>
              Try again
            </button>
          }
        />
      )}

      {profile && (
        <>
          <div className="hero">
            <div className="hero-avatar">
              {profile.profilePic ? <img src={profile.profilePic} alt="" /> : initial}
            </div>
            <div className="hero-main">
              <div className="hero-name">@{profile.username}</div>
              {profile.name && <div className="hero-sub">{profile.name}</div>}
              <div className="statset">
                {stats.map(([n, label]) => (
                  <div key={label} className="stat">
                    <span className="stat-n">{formatCount(n)}</span>
                    <span className="stat-l">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <section className="field">
            <div className="section-label">Blocked tags</div>
            <p className="field-hint">Add a tag to hide it from your feeds.</p>
            {profile.blockedTags.length > 0 && (
              <div className="chip-row">
                {profile.blockedTags.map((t) => (
                  <span key={t} className={saving ? 'chip static' : 'chip'}>
                    {t}
                    <button
                      type="button"
                      aria-label={'Remove ' + t}
                      onClick={() => removeTag(t)}
                      className="chip-x"
                      disabled={saving}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="toolbar sidebar-search-wrap">
              <input
                className="field-search"
                placeholder="Search tags to block…"
                role="combobox"
                aria-expanded={sugOpen}
                aria-autocomplete="list"
                aria-controls="blocked-tag-suggestions"
                aria-activedescendant={
                  sugOpen && activeSug >= 0 ? 'blocked-tag-opt-' + activeSug : undefined
                }
                value={tag}
                onChange={(e) => {
                  setTag(e.target.value)
                  setShowSug(true)
                  setActiveSug(-1)
                }}
                onFocus={() => setShowSug(true)}
                onBlur={() => setTimeout(() => setShowSug(false), 120)}
                onKeyDown={onTagKeyDown}
              />
              {sugOpen && (
                <div id="blocked-tag-suggestions" role="listbox" className="menu-panel">
                  {suggestions.map((s, i) => (
                    <button
                      key={s}
                      id={'blocked-tag-opt-' + i}
                      type="button"
                      role="option"
                      aria-selected={i === activeSug}
                      className={i === activeSug ? 'menu-row active' : 'menu-row'}
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
              <button
                className="btn btn-ember"
                onClick={() => addTag()}
                disabled={saving || !tag.trim()}
              >
                {saving ? 'Saving…' : 'Add'}
              </button>
            </div>
            {!known && (
              <div className="field-hint warn">
                “{tag.trim()}” isn’t a known RedGifs tag — it may not block anything.
              </div>
            )}
          </section>

          {profile.preferences.length > 0 && (
            <section className="field">
              <div className="section-label">Preferences</div>
              <p className="field-hint">Content preferences from your RedGifs account.</p>
              <div className="chip-row">
                {profile.preferences.map((p) => (
                  <span key={p} className="chip static">
                    {p}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="field">
            <div className="section-label">Session</div>
            <p className="field-hint">
              Sign out and clear the stored RedGifs token from this device.
            </p>
            <div>
              <button
                className="btn btn-danger"
                onClick={() => setConfirmSignOut(true)}
                disabled={signingOut}
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </section>
        </>
      )}

      {confirmSignOut && (
        <ConfirmDialog
          title="Sign out?"
          body="This clears the stored RedGifs token from this device. You’ll need to sign in again to see your likes, follows, and feeds."
          confirmLabel="Sign out"
          danger
          onConfirm={signOut}
          onCancel={() => setConfirmSignOut(false)}
        />
      )}
    </div>
  )
}
