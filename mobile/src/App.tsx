import { useState, type JSX } from 'react'
import { AuthCapture, type AuthResult } from './plugins/authCapture'
import { decodeJwt, isUserToken } from './lib/jwt'

export default function App(): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AuthResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function signIn(): Promise<void> {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await AuthCapture.login())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const token = result?.token
  const claims = token ? decodeJwt(token) : null

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif', lineHeight: 1.5 }}>
      <h1>RedLoader — auth capture spike</h1>
      <button onClick={signIn} disabled={busy} style={{ padding: '10px 18px', fontSize: 16 }}>
        {busy ? 'Opening sign-in…' : 'Sign in to RedGifs'}
      </button>

      {error && <p style={{ color: 'crimson' }}>Error: {error}</p>}

      {result?.cancelled && <p>Sign-in window closed with no token captured.</p>}

      {token && (
        <section style={{ marginTop: 20 }}>
          <p>
            <b>Captured via:</b> {result?.source}
          </p>
          <p>
            <b>Is user token:</b> {String(isUserToken(token))}
          </p>
          <p>
            <b>preferred_username:</b> {String(claims?.preferred_username ?? '—')}
          </p>
          <p>
            <b>sub:</b> {String(claims?.sub ?? '—')}
          </p>
          <p>
            <b>exp:</b> {String(claims?.exp ?? '—')}
          </p>
          <textarea readOnly value={token} rows={6} style={{ width: '100%', fontSize: 11 }} />
        </section>
      )}
    </main>
  )
}
