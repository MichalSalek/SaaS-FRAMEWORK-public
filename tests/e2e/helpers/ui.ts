// tests/e2e/helpers/ui.ts
//
// Shared browser-UI helpers for the e2e suite.

import type { Page } from '@playwright/test';

/**
 * Dismiss the cookie-consent banner if present.
 *
 * On narrow (mobile) viewports the CookieBanner renders as a bottom sheet that
 * overlays interactive content (Quick Login tiles, footer links, pricing CTAs)
 * and intercepts pointer events (Playwright: "CookieBanner … subtree intercepts
 * pointer events"), so a subsequent click times out. A real user dismisses it
 * before interacting — we do the same.
 *
 * Best-effort: an absent banner (already consented / wide viewport where it
 * doesn't overlap) simply proceeds. We accept EITHER consent button
 * ("Akceptuję wszystkie" / "Tylko niezbędne") so a copy tweak on one label does
 * not silently reintroduce the pointer-interception flake. Labels are the PL
 * default copy (`static.cookieBanner.actions.*` in main/src/locales/pl/common.json).
 *
 * @param timeoutMs budget for the banner to appear+be clicked. Short by design:
 * when the banner is not shown this is pure wait, so keep it tight.
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
