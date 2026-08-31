import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Shared logic lives in @redloader/core; this suite covers renderer-only
    // behavior while storage.test runs with Electron's native ABI below.
    include: ['src/**/*.test.ts'],
    // storage.test.ts needs the Electron-ABI better-sqlite3 native module, so it
    // runs via `npm run test:main` (ELECTRON_RUN_AS_NODE), not this Node run.
    exclude: ['**/node_modules/**', 'src/main/storage.test.ts']
  },
  resolve: {
    alias: { '@shared': new URL('./src/shared', import.meta.url).pathname }
  }
})
