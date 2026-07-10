import { describe, it, expect } from 'vitest'
import { decodeJwt, isUserToken } from './jwt'

function jwt(payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`
}

describe('jwt', () => {
  it('decodes a base64url payload', () => {
    expect(decodeJwt(jwt({ sub: 'user/42' }))?.sub).toBe('user/42')
  })
  it('rejects malformed tokens', () => {
    expect(decodeJwt('nope')).toBeNull()
    expect(decodeJwt('a.b')).toBeNull()
  })
  it('accepts a real user token', () => {
    expect(isUserToken(jwt({ sub: 'user/42' }))).toBe(true)
  })
  it('rejects an anonymous client token', () => {
    expect(isUserToken(jwt({ sub: 'client/abc' }))).toBe(false)
  })
  it('rejects garbage', () => {
    expect(isUserToken('')).toBe(false)
    expect(isUserToken('not-a-jwt')).toBe(false)
  })
})
