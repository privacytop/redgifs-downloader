import { describe, expect, it } from 'vitest'
import { decodeJwt, isUserToken } from './jwt'

// base64url helper for building test tokens (browser-side btoa).
function tok(payload: Record<string, unknown>): string {
  const b64 = (o: unknown): string =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`
}

describe('isUserToken', () => {
  it('accepts a token whose sub is a real user', () => {
    expect(isUserToken(tok({ sub: 'kp_123', preferred_username: 'alice' }))).toBe(true)
  })
  it('rejects an anonymous temp token (sub client/...)', () => {
    expect(isUserToken(tok({ sub: 'client/web' }))).toBe(false)
  })
  it('rejects malformed and too-short tokens', () => {
    expect(isUserToken('nope')).toBe(false)
    expect(isUserToken('')).toBe(false)
  })
})

describe('decodeJwt', () => {
  it('returns the payload claims', () => {
    expect(decodeJwt(tok({ preferred_username: 'bob' }))?.preferred_username).toBe('bob')
  })
  it('returns null on a non-JWT', () => {
    expect(decodeJwt('a.b')).toBeNull()
  })
})
