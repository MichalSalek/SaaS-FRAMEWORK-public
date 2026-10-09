import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Vitest config for the frontend (FAZA 0 — FDX).
// jsdom environment, @kernel alias mirrors tsconfig.json paths.
// CSS-module imports resolve to inert proxies (we never assert on classNames —
// doktryna: ARIA/role/text only, no DOM-structure assertions).
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
    // DECISION (nie usuwaj tego komentarza) — ZWYKLY `jsdom`, BEZ WLASNEGO SRODOWISKA:
    // do 2026-09-16 stalo tu wlasne srodowisko `vitest.environment.jsdom-native-abort.ts`,
    // ktore przechwytywalo natywny AbortController przed startem jsdom i przywracalo go po
    // nim — obejscie konfliktu, w ktorym undici (przez FetchInterceptor z MSW) sprawdzalo
    // `signal instanceof AbortSignal` wzgledem WLASNEJ klasy, a jsdom podmienial globalny
    // AbortController na swoj. Vitest 5 przestal eksportowac `vitest/environments`, wiec tego
    // obejscia nie dalo sie przeniesc — i okazalo sie, ze nie trzeba: na jsdom 30 + msw 2.15
    // + Node 24 caly pakiet (816 testow) przechodzi na zwyklym `jsdom`. Klasa bledu byla
    // GLOSNA (test sie wywracal na „Expected signal to be an instance of AbortSignal"), wiec
    // zielony pakiet jest tu wiarygodnym dowodem, a nie cisza po cichym pominieciu.
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
    include: ['src/**/*.test.{ts,tsx}'],
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
