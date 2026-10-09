// tests/e2e/playwright.config.ts
//
// Playwright E2E configuration for Nailfolio critical-path smoke tests.
//
// SCOPE (Wave 6A — PLAN_PRE_LAUNCH_QUALITY_SPRINT):
//   8-10 end-to-end happy-path flows guarding mission-critical paid-tier user
//   journeys. These complement the API-level smoke tests in tests/smoke/* —
//   here we exercise the real frontend + backend together through the browser.
//
// RUNTIME REQUIREMENTS (must be running before `npm run test:e2e`):
//   1. Backend (web-1) on http://localhost:3001 with NODE_ENV_MANUAL=DEVELOPMENT
//      (gates /api/auth/dev-login + auto-seeds TEST_USERS_CONFIG users).
//   2. Frontend (main) on http://localhost:3000 with NEXT_PUBLIC_NODE_ENV_MANUAL
//      =DEVELOPMENT (exposes Quick Login tiles on /user/login).
//   3. Dev DB reachable (e.g. `npm run dev` from the repo root spins both up).
//
// WSL2 NOTE: We pin to chromium only (Firefox/WebKit require system libs that
// fail under default WSL2 + claude-sandbox setups). Run `npx playwright install
// chromium` once on a fresh machine before invoking the tests.
//
// DECISION (nie usuwaj tego komentarza):
// Headless by default. Set HEADED=1 env var for local debugging — we do NOT
// flip on PWDEBUG/UI mode automatically because devs almost always launch
// these from CLI, and the headed inspector pulls in xserver bits that are
// not present on most WSL2 boxes. Keeping headed opt-in keeps the smoke-run
// path uniform between local + CI.

import { defineConfig, devices } from '@playwright/test';

const FRONTEND_BASE_URL =
  process.env['E2E_FRONTEND_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './specs',

  // Each individual test gets 30s (CLAUDE.md requirement, pragmatic for the
  // multi-step journeys we exercise — login → onboarding → action).
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
        // Match the viewport our DESIGN.md treats as "desktop baseline" so any
        // CSS-driven affordances (e.g. inline-vs-sticky action bars) match the
        // production layout.
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
