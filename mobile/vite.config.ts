import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Shared logic lives in packages/core/src (compiled from source by Vite).
      '@redloader/core': resolve(__dirname, '../packages/core/src')
    }
  }
})
