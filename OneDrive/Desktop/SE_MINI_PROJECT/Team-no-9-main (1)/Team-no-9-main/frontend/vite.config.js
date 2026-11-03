import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forward API calls to the Express backend during development.
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
  test: {
    // Unit tests only; browser tests in e2e/ run with Playwright (npm run test:e2e).
    include: ['src/**/*.test.{js,jsx}'],
  },
})
