import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Needed so @testing-library/react's auto-cleanup (which detects a
    // global `afterEach`) unmounts components between tests. Without it,
    // component tests in the same file accumulate DOM nodes across tests.
    globals: true,
    include: ['{lib,app,components}/**/*.test.{ts,tsx}'],
    // Database integration tests talk to a live DB and run only via `npm run test:db`.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      '**/*.integration.test.{ts,tsx}',
    ],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
