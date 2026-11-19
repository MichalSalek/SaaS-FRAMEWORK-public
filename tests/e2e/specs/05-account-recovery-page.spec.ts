// tests/e2e/specs/05-account-recovery-page.spec.ts
//
// CRITICAL PATH #5 (Forgot password → recovery email → reset → login):
//   We exercise the entry surface — the "did you delete your account /
//   need help getting back in?" recovery page. Magic-link auth means there is
//   no classic forgot-password flow; the equivalent UX is the account
//   recovery page reachable from the login footer (see LoginPage.tsx — the
//   `USER_RECOVER` link).
//
//   1. Unauthenticated visitor navigates to /user/login.
//   2. The "recover account" link is visible.
//   3. Following it lands on a page that renders (no 404, no 500) — we
//      cannot complete a full restoration in CI because the API requires a
//      deleted user in pending-recovery state which would corrupt the
//      seeded test users for other tests.

import { test, expect } from '@playwright/test';
import { E2E_ENV } from '../helpers/env';
import { dismissCookieBanner } from '../helpers/ui';

test.describe('account recovery: entry surface reachable from login', () => {
  test('login footer surfaces recover link and it loads a real page', async ({
    page,
  }) => {
    await page.goto('/user/login');

    // The login page footer contains the "recoverAccount" link styled as a
    // Typography element inside a <Link>. The translation key is `recoverAccount`
    // (default PL copy). Match resiliently — case-insensitive substring. The
    // auto-waiting visibility assertion doubles as the deterministic hydration
    // signal (replaces networkidle): once the footer link is visible the page
    // is interactive.
    const possibleLabels = /odzyska|przywróć|przywroc|recover|reset|restore/i;
    const recoverLink = page
      .locator('a')
      .filter({ hasText: possibleLabels })
      .first();
    await expect(recoverLink).toBeVisible({ timeout: 10_000 });

    // Dismiss the cookie-consent bottom sheet — on narrow viewports it overlays
    // the login footer and intercepts the click on the recover link (Playwright:
    // "CookieBanner … subtree intercepts pointer events"). Shared helper.
    // Dismissed AFTER the hydration signal above so the banner (client-side
    // rendered) had a chance to mount before we try to close it.
    await dismissCookieBanner(page);

    await recoverLink.click();

    // The recover link lands on the logged-out recovery hub: /app/user/recover
    // renders its `!hasSessionToken()` branch for an unauthenticated visitor
    // (route is in ACCOUNT_ROUTE_PREFIXES — nothing bounces it). Wait for the
    // client-side nav to ACTUALLY arrive there, then assert the hub rendered.
    // We deliberately do NOT tolerate staying on /user/login: this test starts ON
    // /user/login, so a dead link that no-ops (JS error / overlay / broken href)
    // would still match a login URL and pass vacuously — waitForURL(recover) +
    // the hub marker make a no-op click fail, which is the whole point.
    await page.waitForURL(/\/app\/user\/recover/, { timeout: 15_000 });
    await expect(page.getByText(/zamkni.te konto/i)).toBeVisible();

    // Sanity: page has rendered content, not a stack trace.
    const bodyText = (await page.textContent('body')) ?? '';
    expect(bodyText.length).toBeGreaterThan(50);
    expect(bodyText.toLowerCase()).not.toContain('internal server error');

    // Pin to E2E_ENV so the import is used (forces consistency with the rest
    // of the suite — if env wiring breaks the link click target inverts).
    expect(E2E_ENV.FRONTEND_URL.length).toBeGreaterThan(0);
  });
});
