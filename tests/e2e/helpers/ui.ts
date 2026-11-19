// tests/e2e/helpers/ui.ts
//
// Shared browser-UI helpers for the e2e suite.

import type { Page } from '@playwright/test';

/**
 * Dismiss the cookie-consent banner if present.
 *
 * On narrow viewports the CookieBanner is a bottom sheet that intercepts pointer events over Quick Login
 * tiles, footer links and pricing CTAs, so a later click times out. A real user dismisses it first.
 *
 * Best-effort: an absent banner simply proceeds. EITHER consent button is accepted ("Akceptuję
 * wszystkie" / "Tylko niezbędne") so a copy tweak on one label does not reintroduce the flake; labels are
 * the PL default copy (`static.cookieBanner.actions.*` in main/src/locales/pl/common.json).
 *
 * @param timeoutMs budget for the banner to appear and be clicked; keep it tight, it is pure wait when
 * the banner is not shown.
 */
export async function dismissCookieBanner(
  page: Page,
  timeoutMs = 3000
): Promise<void> {
  await page
    .getByRole('button', { name: /Akceptuję wszystkie|Tylko niezbędne/i })
    .first()
    .click({ timeout: timeoutMs })
    .catch(() => {
      /* banner not shown / already dismissed — continue */
    });
}
