// tests/prod/playwright.prod.config.ts
//
// Przeglądarkowa część sanity produkcji. Świadomie oddzielona od
// tests/e2e/playwright.config.ts, bo tamta suita opiera się na dev-loginie i
// wolno jej zmieniać stan bazy; tutaj gramy na żywym systemie i obowiązuje
// zasada „czytaj, nie psuj": logujemy się jak człowiek (magic-link ze skrzynki)
// i sprawdzamy, czy zalogowany interfejs faktycznie wstaje.

import { defineConfig, devices } from '@playwright/test';

const FRONTEND_BASE_URL =
  process.env['PROD_FRONTEND_URL'] ?? 'https://nailfolio.app';

export default defineConfig({
  testDir: './specs',
  // Logowanie idzie przez pocztę, więc pojedynczy test bywa dłuższy niż lokalny.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env['CI'],
  retries: 0,
  // Jeden worker: wszystkie testy dzielą jedno konto testowe i jedną skrzynkę.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: FRONTEND_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 30_000,
    headless: process.env['HEADED'] !== '1',
  },
  projects: [
    {
      // Telefon jako punkt odniesienia — produkt jest mobile-first, a to właśnie
      // na telefonie logowanie się wywróciło.
      name: 'mobile-chromium',
      use: {
        ...devices['iPhone SE'],
        browserName: 'chromium',
        viewport: { width: 375, height: 667 },
        isMobile: true,
      },
    },
  ],
  outputDir: './test-results',
});
