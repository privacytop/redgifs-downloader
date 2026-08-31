import { registerPlugin } from '@capacitor/core'

export interface AuthResult {
  token?: string
  username?: string
  source?: 'header' | 'localStorage'
  cancelled?: boolean
}

interface AuthCapturePlugin {
  login(): Promise<AuthResult>
  /** Silently mint a fresh user token from the persisted RedGifs web session. */
  refresh(opts?: { previousToken?: string }): Promise<AuthResult>
  /** Stop any visible or hidden auth WebView. */
  cancel(): Promise<void>
  /** Cancel auth and clear RedGifs cookies plus WebView storage. */
  logout(): Promise<void>
}

/** Bridge to the native AuthCapture plugin (mobile/android AuthCapturePlugin.java). */
export const AuthCapture = registerPlugin<AuthCapturePlugin>('AuthCapture')
