// tests/e2e/playwright.config.ts
//
// Playwright E2E configuration: critical-path flows of the paid-tier journeys.
//
// Needed running before `npm run test:e2e` (`npm run dev` from the repo root starts both):
//   1. Backend (web-1) on :3001 with NODE_ENV_MANUAL=DEVELOPMENT (gates /api/auth/dev-login and seeds
//      TEST_USERS_CONFIG users).
//   2. Frontend (main) on :3000 with NEXT_PUBLIC_NODE_ENV_MANUAL=DEVELOPMENT (Quick Login tiles).
//   3. Dev DB reachable.
//
// WSL2: chromium only (Firefox/WebKit need system libs missing under default WSL2 setups); run
// `npx playwright install chromium` once on a fresh machine.
//
// DECISION: headless by default; HEADED=1 opts in. PWDEBUG/UI mode is not flipped on automatically:
// these run from the CLI and the headed inspector needs xserver bits missing on most WSL2 boxes.

import { defineConfig, devices } from '@playwright/test';

const FRONTEND_BASE_URL =
  process.env['E2E_FRONTEND_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './specs',



  timeout: 30_000,

  // Total expect() assertion timeout — keep short so failures surface fast.
  expect: {
    timeout: 7_500,
  },

  // Fail the build on CI if .only() is committed by accident.
  forbidOnly: !!process.env['CI'],

  // Retries: 1 locally (flake tolerance for first attempts hitting cold
  // backend caches), 2 on CI.
  retries: process.env['CI'] ? 2 : 1,

  // Serial workers — these tests share the seeded dev DB and rely on stable
  // test-user state. Parallel runs would race on cleanup (`afterEach` deletes
  // created resources owned by the same user). Acceptable trade-off for a
  // small smoke suite; if the suite grows past ~30 tests we should pivot to
  // per-test database fixtures.
  workers: 1,

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],

  use: {
    baseURL: FRONTEND_BASE_URL,

    // Capture artefacts only on failure — fast green runs, rich red runs.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Accept the dev TLS cert if anyone ever runs https locally.
    ignoreHTTPSErrors: true,

    // Default navigation budget — most pages SSR within 5s on dev.
    actionTimeout: 10_000,
    navigationTimeout: 15_000,

    // Honour HEADED=1 escape hatch.
    headless: process.env['HEADED'] !== '1',
  },

  projects: [
    {
      // chromium only — see WSL2 note above.
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],


        viewport: { width: 1280, height: 800 },
      },
    },
    {
      // Mobile baseline — app is mobile-first (<480 breakpoint) and ships as a
      // Capacitor WebView (Android/iOS). iPhone SE is the smallest supported
      // screen and exercises the tightest layout constraints. Running the same
      // specs here catches regressions that only surface at narrow widths (e.g.
      // overflow, touch-target size, viewport-unit clipping).
      name: 'mobile-chromium',
      use: {
        ...devices['iPhone SE'],
        // iPhone SE's preset defaults to the WebKit engine, which isn't
        // installed/working on WSL2 (see the chromium-only note above) — pin the
        // engine to chromium so "mobile-chromium" really is chromium at a phone
        // viewport (not WebKit). The specs assert DOM/logic, not engine quirks.
        browserName: 'chromium',
        // Explicit override keeps the baseline stable even if the Playwright
        // device preset changes between versions.
        viewport: { width: 375, height: 667 },
        isMobile: true,
      },
    },
  ],

  // Output everything under tests/e2e/playwright-report and -results so they
  // are easy to git-ignore (.gitignore entry added separately).
  outputDir: './test-results',
});
