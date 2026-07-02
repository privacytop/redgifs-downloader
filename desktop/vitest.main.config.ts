import { defineConfig } from 'vitest/config'

// Config for tests that require the Electron-ABI native modules (better-sqlite3).
// Run via `npm run test:main` (ELECTRON_RUN_AS_NODE=1 electron ...).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/storage.test.ts']
  },
  resolve: {
    alias: { '@shared': new URL('./src/shared', import.meta.url).pathname }
  }
})
