// Decode + classify RedGifs JWTs. Anonymous temp tokens have sub "client/...";
// real user tokens do not. No signature verification (we only classify).
export function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
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
