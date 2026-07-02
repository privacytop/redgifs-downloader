import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  },
  resolve: {
    alias: { '@shared': new URL('./src/shared', import.meta.url).pathname }
  }
})
