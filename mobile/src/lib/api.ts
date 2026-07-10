import { RedgifsApi } from '@redloader/core'

/**
 * The app-wide RedGifs API client. Anonymous by default (temp token); the
 * signed-in user token is set on it by the auth manager (phase 3). Shared core
 * code, so its endpoint contracts match the desktop app exactly.
 */
export const api = new RedgifsApi()
