import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../context/auth'
import { useToast } from '../context/toast'
import { formatCount } from '../lib/format'
import type { UserProfile } from '@redloader/core'
import { IconUser } from '../components/icons'

/** Account screen: sign in / out and the signed-in profile summary. */
export default function You(): React.JSX.Element {
  const { authenticated, username, ready, login, logout } = useAuth()
  const notify = useToast()
  const [busy, setBusy] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)

  useEffect(() => {
    if (!authenticated) {
      setProfile(null)
      return
    }
    let alive = true
    api
      .getProfile()
      .then((p) => {
        if (alive) setProfile(p)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [authenticated])

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

  return (
    <div className="page">
      <div className="kicker">Account</div>
      <h1 className="title">You</h1>
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
              {profile?.profilePic ? (
                <img src={profile.profilePic} alt="" />
              ) : (
                (username?.[0] ?? '?').toUpperCase()
              )}
            </div>
            <div className="creator-info">
              <div className="creator-name">@{username}</div>
              {profile && (
                <div className="creator-sub">
                  {formatCount(profile.followers)} followers · {formatCount(profile.totalGifs)} gifs
                </div>
              )}
            </div>
          </div>

          <button className="btn btn-block" disabled={busy} onClick={() => void doLogout()}>
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </>
      )}
    </div>
  )
}
