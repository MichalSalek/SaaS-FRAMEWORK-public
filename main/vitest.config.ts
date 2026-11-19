import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Vitest config for the frontend.
// jsdom environment, @kernel alias mirrors tsconfig.json paths.
// CSS-module imports resolve to inert proxies (we never assert on classNames —
// rule: ARIA/role/text only, no DOM-structure assertions).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@kernel': fileURLToPath(
        new URL('./src/READONLY-shared-kernel', import.meta.url)
      ),
    },
  },
  test: {
    globals: true,
    // DECISION: plain `jsdom`, no custom environment. The old workaround (restoring the native
    // AbortController after jsdom starts, for undici's `signal instanceof AbortSignal` check under MSW)
    // is unnecessary on jsdom 30 + msw 2.15 + Node 24, and Vitest 5 no longer exports
    // `vitest/environments`. The failure class is loud ("Expected signal to be an instance of
    // AbortSignal"), so a green suite is real evidence.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Stub NEXT_PUBLIC_* env vars required by validateEnv (environment.config.ts).
    // NEXT_PUBLIC_NODE_ENV_MANUAL=DEVELOPMENT → soft mode (warn-only, no throw).
    // These are test stubs — never real secrets.
    env: {
      NEXT_PUBLIC_NODE_ENV_MANUAL: 'DEVELOPMENT',
      NEXT_PUBLIC_HTTP_PROTOCOL: 'http://',
      NEXT_PUBLIC_BACKEND_PUBLIC_DOMAIN: 'localhost',
      NEXT_PUBLIC_BACKEND_PUBLIC_PORT: '3001',
      NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: 'test-cloud',
      NEXT_PUBLIC_DEFAULT_LOCALE: 'pl',
      NEXT_PUBLIC_TIMEZONE: 'Europe/Warsaw',
    },
    // `eslint-rules/` and `css-rules/` hold the local guard rules and their suites.
    include: [
      'src/**/*.test.{ts,tsx}',
      'eslint-rules/**/*.test.mjs',
      'css-rules/**/*.test.mjs',
    ],
    exclude: ['node_modules', '.next', 'out', 'dist'],
    // CSS Modules → return the proxied key string instead of parsing real CSS.
    // Keeps tests fast and decoupled from styling churn.
    css: false,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      // Coverage is report-only — NEVER a gate (doktryna W0.1).
      reporter: ['text-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test-utils/**'],
    },
  },
});
