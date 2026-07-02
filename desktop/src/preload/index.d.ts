import type { RedgifsApi } from '../shared/ipc'

declare global {
  interface Window {
    api: RedgifsApi
  }
}

export {}
