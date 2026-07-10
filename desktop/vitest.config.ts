import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // The shared-logic tests (api/jwt/ratelimit/indexer/download) moved to
    // @redloader/core; storage.test runs via `test:main` (Electron ABI). So the
    // plain node run may legitimately match nothing.
    passWithNoTests: true,
    include: ['src/**/*.test.ts'],
    // storage.test.ts needs the Electron-ABI better-sqlite3 native module, so it
    // runs via `npm run test:main` (ELECTRON_RUN_AS_NODE), not this Node run.
    exclude: ['**/node_modules/**', 'src/main/storage.test.ts']
  },
  resolve: {
    alias: { '@shared': new URL('./src/shared', import.meta.url).pathname }
  }
})
