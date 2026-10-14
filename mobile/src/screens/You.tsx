import { useEffect, useState } from 'react'
import { useNavigate } from '../nav'
import { api } from '../lib/api'
import { useAuth } from '../context/auth'
import { useToast } from '../context/toast'
import { useCachedResource } from '../hooks/useCachedResource'
import { formatCount } from '../lib/format'
import { setBlockedTags } from '../lib/blockedTags'
import type { UserProfile } from '@redloader/core'
import { IconGear, IconUser } from '../components/icons'
import ScreenHeader from '../components/ScreenHeader'
import IconButton from '../components/IconButton'
import { CachedImage } from '../components/CachedMedia'

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
    // Keyed by account so a re-login as someone else never paints the previous
    // avatar/stats while the fetch is in flight.
    `me:profile:${username ?? 'anon'}`,
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
    <IconButton label="Settings" variant="solid" onClick={() => navigate('/settings')}>
      <IconGear />
    </IconButton>
  )

  return (
    <div className="page">
      <ScreenHeader title="You" right={gear} />

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
              {profile?.profilePic ? (
                <CachedImage cacheKey={`creator:${username ?? 'me'}`} src={profile.profilePic} alt="" />
              ) : (username?.[0] ?? '?').toUpperCase()}
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

/**
 * Blocked tags — view, add, remove (mirrors desktop Account). Edits are
 * optimistic: the chip list and the app-wide block set change at once (every
 * feed re-filters immediately); a failed save reverts both with a toast.
 */
function BlockedTags({ profile, onChanged }: { profile: UserProfile; onChanged: () => void }): React.JSX.Element {
  const notify = useToast()
  const [tag, setTag] = useState('')
  const [blocked, setBlocked] = useState<string[]>(profile.blockedTags)
  const [pending, setPending] = useState<Set<string>>(new Set())

  useEffect(() => {
    setBlocked(profile.blockedTags)
    setBlockedTags(profile.blockedTags)
  }, [profile.blockedTags])

  // RedGifs JSON-patch "add" replaces the whole array, so send the full list.
  const save = async (next: string[], touched: string): Promise<void> => {
    const prev = blocked
    setBlocked(next)
    setBlockedTags(next)
    setPending((p) => new Set(p).add(touched))
    try {
      await api.updatePreferences([
        { op: 'add', path: '/preferences', value: profile.preferences },
        { op: 'add', path: '/blocked_tags', value: next }
      ])
      onChanged()
    } catch (e) {
      setBlocked(prev)
      setBlockedTags(prev)
      notify('Update failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setPending((p) => {
        const s = new Set(p)
        s.delete(touched)
        return s
      })
    }
  }

  const add = (): void => {
    const t = tag.trim()
    if (!t || blocked.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setTag('')
      return
    }
    setTag('')
    void save([...blocked, t], t)
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
            style={pending.has(t) ? { opacity: 0.5 } : undefined}
            onClick={() => void save(blocked.filter((x) => x !== t), t)}
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
        <button className="btn btn-ember btn-sm" disabled={!tag.trim()} onClick={add}>
          Block
        </button>
      </div>
    </>
  )
}
