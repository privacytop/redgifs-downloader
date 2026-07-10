import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../context/auth'
import { useToast } from '../context/toast'
import { useCachedResource } from '../hooks/useCachedResource'
import { formatCount } from '../lib/format'
import type { UserProfile } from '@redloader/core'
import { IconGear, IconUser } from '../components/icons'

/** Account + profile: sign in/out, stats, blocked tags, preferences, settings. */
export default function You(): React.JSX.Element {
  const { authenticated, username, ready, login, logout } = useAuth()
  const navigate = useNavigate()
  const notify = useToast()
  const [busy, setBusy] = useState(false)

  const {
    data: profile,
    loading,
    refresh
  } = useCachedResource<UserProfile | null>(
    'me:profile',
    () => (authenticated ? api.getProfile() : Promise.resolve(null)),
    [authenticated]
  )

  const doLogin = async (): Promise<void> => {
    setBusy(true)
    try {
      await login()
    } catch (e) {
      notify('Sign-in failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setBusy(false)
    }
  }
  const doLogout = async (): Promise<void> => {
    setBusy(true)
    try {
      await logout()
      notify('Signed out', 'info')
    } finally {
      setBusy(false)
    }
  }

  const gear = (
    <button className="btn btn-sm" onClick={() => navigate('/settings')} aria-label="Settings">
      <IconGear />
    </button>
  )

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 className="title">You</h1>
        {gear}
      </div>
      <hr className="rule" />

      {!ready ? (
        <div className="loading">Loading…</div>
      ) : !authenticated ? (
        <div className="empty">
          <div className="avatar" style={{ width: 64, height: 64 }} aria-hidden="true">
            <IconUser />
          </div>
          <div className="empty-msg">Not signed in</div>
          <div className="empty-sub">
            Sign in with your RedGifs account to browse your likes and collections and index your
            library.
          </div>
          <button className="btn btn-ember" disabled={busy} onClick={() => void doLogin()}>
            {busy ? 'Opening sign-in…' : 'Sign in to RedGifs'}
          </button>
        </div>
      ) : (
        <>
          <div className="creator" style={{ marginBottom: 18 }}>
            <div className="avatar" aria-hidden="true">
              {profile?.profilePic ? <img src={profile.profilePic} alt="" /> : (username?.[0] ?? '?').toUpperCase()}
            </div>
            <div className="creator-info">
              <div className="creator-name">@{username}</div>
              <div className="creator-sub">{profile?.name || 'RedGifs account'}</div>
            </div>
          </div>

          {profile && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 12,
                marginBottom: 20
              }}
            >
              <Stat n={profile.followers} label="Followers" />
              <Stat n={profile.following} label="Following" />
              <Stat n={profile.totalGifs} label="Gifs" />
              <Stat n={profile.views} label="Views" />
              <Stat n={profile.likes} label="Likes" />
            </div>
          )}

          {loading && !profile && <div className="loading">Loading profile…</div>}

          {profile && <BlockedTags profile={profile} onChanged={refresh} />}

          {profile && profile.preferences.length > 0 && (
            <>
              <div className="section-label">Preferences</div>
              <div className="chip-row" style={{ marginBottom: 20 }}>
                {profile.preferences.map((p) => (
                  <span key={p} className="chip" style={{ cursor: 'default' }}>
                    {p}
                  </span>
                ))}
              </div>
            </>
          )}

          <button className="btn btn-block" disabled={busy} onClick={() => void doLogout()}>
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </>
      )}
    </div>
  )
}

function Stat({ n, label }: { n: number; label: string }): React.JSX.Element {
  return (
    <div className="tile" style={{ padding: '12px 10px', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 20, color: 'var(--cream)' }}>{formatCount(n)}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, textTransform: 'uppercase', color: 'var(--mut)', marginTop: 2 }}>
        {label}
      </div>
    </div>
  )
}

/** Blocked tags — view, add, remove (mirrors desktop Account). */
function BlockedTags({ profile, onChanged }: { profile: UserProfile; onChanged: () => void }): React.JSX.Element {
  const notify = useToast()
  const [tag, setTag] = useState('')
  const [saving, setSaving] = useState(false)
  const blocked = profile.blockedTags

  // RedGifs JSON-patch "add" replaces the whole array, so send the full list.
  const save = async (next: string[]): Promise<void> => {
    setSaving(true)
    try {
      await api.updatePreferences([
        { op: 'add', path: '/preferences', value: profile.preferences },
        { op: 'add', path: '/blocked_tags', value: next }
      ])
      notify('Updated blocked tags', 'success')
      onChanged()
    } catch (e) {
      notify('Update failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setSaving(false)
    }
  }

  const add = (): void => {
    const t = tag.trim()
    if (!t || blocked.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setTag('')
      return
    }
    setTag('')
    void save([...blocked, t])
  }

  return (
    <>
      <div className="section-label">Blocked tags</div>
      <div className="chip-row" style={{ marginBottom: 10 }}>
        {blocked.length === 0 && <span className="readout">None</span>}
        {blocked.map((t) => (
          <button
            key={t}
            className="chip"
            disabled={saving}
            onClick={() => void save(blocked.filter((x) => x !== t))}
            title="Remove"
          >
            {t} ✕
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          className="search"
          placeholder="Block a tag…"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <button className="btn btn-ember btn-sm" disabled={saving || !tag.trim()} onClick={add}>
          Block
        </button>
      </div>
    </>
  )
}
