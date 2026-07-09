import { useState } from 'react'
import EmptyState from './EmptyState'
import { useNotify } from '../context/notify'

interface SignInGateProps {
  /** What the user unlocks by signing in. */
  message?: string
  hint?: string
}

/**
 * The one sign-in wall. Every auth-gated page renders this in its signed-out
 * branch instead of copy-pasting an EmptyState + login button, so the copy and
 * the action stay identical everywhere.
 */
export default function SignInGate({
  message = 'Sign in to see this',
  hint = 'Connect a RedGifs account to continue.'
}: SignInGateProps): JSX.Element {
  const notify = useNotify()
  const [busy, setBusy] = useState(false)

  // Same semantics as the shell's sign-in: one login path, errors surface as
  // a toast instead of a silently rejected promise.
  const signIn = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await window.api.login()
    } catch (e) {
      notify('Sign in failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <EmptyState
      message={message}
      hint={hint}
      action={
        <button className="btn btn-ember" disabled={busy} onClick={() => void signIn()}>
          {busy ? 'Opening browser…' : 'Sign in'}
        </button>
      }
    />
  )
}
