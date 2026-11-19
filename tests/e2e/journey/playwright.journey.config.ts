// tests/e2e/journey/playwright.journey.config.ts
//
// The nightly browser journey. Unlike tests/e2e/playwright.config.ts
// (dev stack, dev-login, seeded users) this runs against PRODUCTION builds of main and web-1 in
// PREVIEW mode on a disposable database, started by tests/ci/run-e2e-local.sh or
// .github/workflows/e2e-nightly.yml. Nothing here starts servers: the harness does.
//
// DECISION: retries 0. A nightly that passes on its second attempt hides exactly the flake it
// exists to find; the journey has no fixed sleeps (web-first assertions and polled mail reads), so a
// red run is a finding. The trace of both users' contexts is kept for a red run; the spec attaches
// its own screenshots (always for the key screens, both users on failure).

import { defineConfig, devices } from '@playwright/test';

const OUTPUT_DIR = process.env['E2E_OUTPUT_DIR'] ?? './journey-results';

export default defineConfig({
  testDir: './',
  testMatch: /.*\.journey\.ts$/,
  // One journey of ~15 UI steps across two browser contexts; a cold production server answers its
  // first renders in a few seconds, so the budget is per step (action/navigation) plus a ceiling.
  timeout: 240_000,
  expect: { timeout: 20_000 },
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    [
      'html',
      { open: 'never', outputFolder: `${OUTPUT_DIR}/playwright-report` },
    ],
    ['junit', { outputFile: `${OUTPUT_DIR}/junit.xml` }],
  ],
  outputDir: `${OUTPUT_DIR}/test-results`,
  use: {
    baseURL: process.env['E2E_FRONTEND_URL'] ?? 'http://localhost:3329',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
  },
  projects: [
    {
      // A phone: on PREVIEW/PRODUCTION a plain user on a desktop viewport is sent to /get-app
      // (desktop-access.policy.ts), and the product is mobile-first. Chromium engine (WSL2 and the
      // CI runner both have it), Pixel 7 metrics.
      name: 'phone-chromium',
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
  ],
});
