import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Vitest config for web-1 backend unit + integration-handler tests (BDX FAZA 0).
 *
 * - `node` environment (no jsdom) — backend pure logic + node-mocks-http.
 * - Aliases @kernel/@app/@domain mirror tsconfig.json paths so `vi.mock('@app/...')`
 *   resolves to the SAME absolute file that handlers import (today via relative paths,
 *   post-W1.1 via aliases). Without these, mocks would not intercept handler deps.
 * - `env` provides fake secrets + NODE_ENV_MANUAL=DEVELOPMENT so kernel `validateEnv`
 *   stays soft and `PrismaPg`/adapters do not throw on module-load when a handler is
 *   imported by an integration-handler test.
 * - `next build` is untouched (vitest lives outside the bundle).
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@kernel\/(.*)$/,
        replacement: r('./src/READONLY-shared-kernel/$1'),
      },
      { find: /^@app\/(.*)$/, replacement: r('./src/application/$1') },
      { find: /^@domain\/(.*)$/, replacement: r('./src/domain/$1') },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-utils/setup.ts'],
    env: {
      NODE_ENV_MANUAL: 'DEVELOPMENT',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      DATABASE_APP_LOGS_URL: 'postgresql://test:test@localhost:5432/test_logs',
      BETTER_AUTH_SECRET: 'test-better-auth-secret-0123456789abcdef',
      BETTER_AUTH_URL: 'http://localhost:3001',
      PUBLIC_URL: 'http://localhost:3001',
      FRONTEND_PUBLIC_DOMAIN: 'http://localhost:3000',
      INTERNAL_SHARED_SECRET: 'test-internal-shared-secret-0123456789',
    },
  },
});
