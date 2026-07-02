import { useEffect, useState, type CSSProperties } from 'react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useNotify } from '../context/notify'
import { formatCount } from '../lib/format'
import type { UserProfile } from '@shared/types'

/** Account page — profile header card, blocked-tags editor, sign out. Requires auth. */
export default function Account(): JSX.Element {
  const notify = useNotify()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [tag, setTag] = useState('')
  const [adding, setAdding] = useState(false)

  const refetch = (): void => {
    window.api
      .getProfile()
      .then((p) => setProfile(p))
      .catch((e) => notify('Couldn’t load profile: ' + e.message, 'error'))
  }

  useEffect(() => {
    let alive = true
    window.api
      .authStatus()
      .then((s) => {
        if (!alive) return
        setAuthed(s.authenticated)
        if (s.authenticated) {
          window.api
            .getProfile()
            .then((p) => {
              if (alive) setProfile(p)
            })
            .catch((e) => {
              if (alive) notify('Couldn’t load profile: ' + e.message, 'error')
            })
        }
      })
      .catch(() => {
        if (alive) setAuthed(false)
      })
    return () => {
      alive = false
    }
  }, [notify])

  const addTag = (): void => {
    const t = tag.trim().toLowerCase()
    if (!t || adding) return
    setAdding(true)
    window.api
      .updatePreferences([{ op: 'add', path: '/blocked_tags', value: [t] }])
      .then(() => {
        notify('Updated', 'success')
        setTag('')
        refetch()
      })
      .catch((e) => notify('Update failed: ' + e.message, 'error'))
      .finally(() => setAdding(false))
  }

  const removeTag = (t: string): void => {
    window.api
      .updatePreferences([{ op: 'remove', path: '/blocked_tags', value: [t] }])
      .then(() => {
        notify('Updated', 'success')
        refetch()
      })
      .catch((e) => notify('Update failed: ' + e.message, 'error'))
  }

  const signOut = (): void => {
    window.api
      .logout()
      .then(() => {
        setAuthed(false)
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
            <div style={{ display: 'flex', gap: 8, maxWidth: 420 }}>
              <input
                style={{ flex: 1 }}
                placeholder="e.g. spoilers"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addTag()
                }}
              />
              <button className="btn btn-ember" onClick={addTag} disabled={adding || !tag.trim()}>
                {adding ? 'Adding…' : 'Add'}
              </button>
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
