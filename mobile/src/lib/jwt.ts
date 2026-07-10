// Browser port of desktop/src/main/jwt.ts. Classifies RedGifs JWTs; no
// signature verification. Anonymous temp tokens have sub "client/...".
export function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(b64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    )
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

export function isUserToken(token: string): boolean {
  if (!token || token.length < 20) return false
  const payload = decodeJwt(token)
  if (!payload) return false
  const sub = payload.sub
  if (typeof sub === 'string' && sub.startsWith('client/')) return false
  return true
}
