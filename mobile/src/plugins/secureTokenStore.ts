import { registerPlugin } from '@capacitor/core'

interface StoredToken {
  value?: string
}

interface SecureTokenStorePlugin {
  get(): Promise<StoredToken>
  set(options: { value: string }): Promise<void>
  remove(): Promise<void>
}

/** Android Keystore-backed storage for the short-lived RedGifs user token. */
export const SecureTokenStore = registerPlugin<SecureTokenStorePlugin>('SecureTokenStore')
