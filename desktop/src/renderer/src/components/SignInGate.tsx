import EmptyState from './EmptyState'

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
  return (
    <EmptyState
      message={message}
      hint={hint}
      action={
        <button className="btn btn-ember" onClick={() => window.api.login()}>
          Sign in
        </button>
      }
    />
  )
}
