// Decode + classify RedGifs JWTs. Anonymous temp tokens have sub "client/...";
// real user tokens do not. No signature verification (we only classify).
//
// Base64 is decoded universally: `atob` in a browser/WebView, Node's Buffer in
// the Electron main process — so this module is shared by desktop and mobile.

function base64UrlDecode(seg: string): string {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/')
  if (typeof atob === 'function') {
    // Browser/WebView path: atob → binary string → UTF-8.
    const bin = atob(b64)
    let out = ''
    for (let i = 0; i < bin.length; i++) {
      out += '%' + bin.charCodeAt(i).toString(16).padStart(2, '0')
    }
    return decodeURIComponent(out)
  }
  // Node path (Electron main). Reach Buffer off globalThis with a local shape so
  // this shared module typechecks in the mobile/browser build without pulling in
  // @types/node.
  const g = globalThis as {
    Buffer?: { from(data: string, encoding: string): { toString(encoding: string): string } }
  }
  if (g.Buffer) return g.Buffer.from(b64, 'base64').toString('utf-8')
  throw new Error('No base64 decoder available')
}

export function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>
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
