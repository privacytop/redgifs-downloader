import { registerPlugin } from '@capacitor/core'

export interface AuthResult {
  token?: string
  username?: string
  source?: 'header' | 'localStorage'
  cancelled?: boolean
}

interface AuthCapturePlugin {
  login(): Promise<AuthResult>
}

/** Bridge to the native AuthCapture plugin (mobile/android AuthCapturePlugin.java). */
export const AuthCapture = registerPlugin<AuthCapturePlugin>('AuthCapture')
