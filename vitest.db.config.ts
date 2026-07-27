import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * Config for the live-database integration suite only. Kept separate from
 * vitest.config.ts so `npm test` never touches the network — run
 * deliberately via `npm run test:db` (and, in practice, only with
 * DATABASE_URL supplied by `bw-agent exec softball-database-url ...`).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/db/**/*.integration.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // `lib/db/client.ts` imports `server-only`, which throws unless resolved
      // under the "react-server" export condition (the one Next's bundler
      // sets for server code). Vitest's Node environment externalizes
      // node_modules deps to plain `require`, which doesn't honor Vite's
      // `resolve.conditions` for them — so alias straight to the package's
      // own no-op build instead of relying on condition negotiation.
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
})
