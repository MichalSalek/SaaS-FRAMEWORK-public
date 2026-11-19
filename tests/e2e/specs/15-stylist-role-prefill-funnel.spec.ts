// tests/e2e/specs/15-stylist-role-prefill-funnel.spec.ts
//
// Funnel: the "for stylists" marketing CTA must hand the user off to /user/login carrying BOTH the
// register intent AND a role=stylist hint, so the magic-link callback lands on onboarding with the
// stylist role pre-selected (the readPrefilledRole path).
//
// Scope (mirrors spec 01): the consumer-prefill assertion (a brand-new account on /app/onboarding with
// the stylist RoleCard checked and rolePrefilledHint visible) needs a role-less account, since the
// seeded test stylist is past onboarding. Test #3 mints one via dev-login `?withoutRole=true`, which
// skips the magic-link round-trip (no inbox in e2e) while rendering the REAL onboarding with a prefilled
// role. Tests #1/#2 cover the upstream hops: (1) the marketing CTA URL contract, (2) the login page
// accepting the params. readPrefilledRole is also guarded at unit level.

import { test, expect } from '@playwright/test';
import { loginAsFreshRolelessUser } from '../helpers/auth';

test.describe('funnel: stylist role-prefill from marketing CTA', () => {
  test('for-stylists hero CTA carries intent=register&role=stylist to login', async ({
    page,
  }) => {
    await page.goto('/for-stylists');

    // CSS Modules hash the class name, so match the hashed value by substring —
    // this locator is copy/i18n-proof (the button label is translated PL/EN/DE).
    await page.locator('[class*="heroActions"] button').first().click();

    await page.waitForURL(/\/user\/login/, { timeout: 15_000 });
    const url = new URL(page.url());
    // Trailing slash tolerated — Next is configured with trailingSlash, so the
    // canonical path is `/user/login/`. Assert the route, not the slash.
    expect(url.pathname).toMatch(/\/user\/login\/?$/);
    expect(url.searchParams.get('intent')).toBe('register');
    expect(url.searchParams.get('role')).toBe('stylist');
  });

  test('login page boots with role+intent params (no crash, stays on login)', async ({
    page,
  }) => {
    await page.goto('/user/login?intent=register&role=stylist');

    // The role param is a benign UX hint, not a redirect trigger — the page must
    // render its sign-in surface and stay on /user/login. In DEVELOPMENT that
    // surface is the Quick Login grid only (magic link and providers are hidden
    // there since 2026-08-31), elsewhere the magic-link email field.
    await expect(page.locator('body')).toBeVisible();
    expect(page.url()).toMatch(/\/user\/login/);
    await expect(
      page.locator('input[type="email"], [class*="quickLoginGrid"]').first()
    ).toBeVisible();
  });

  test('fresh role-less account lands on onboarding with stylist pre-selected + hint', async ({
    page,
    context,
  }) => {
    // Unique email per run so the dev-login role-less branch (new-user-only)
    // always fires — a re-used address would already be a created record and
    // never reach the no-account state. We leave the record in the dev DB
    // (Z22 low-scale: no self-purge endpoint cheap enough to wire here; the dev
    // DB is disposable and re-seeded on backend start).
    const freshEmail = `e2e-fresh-${Date.now()}@example.com`;
    await loginAsFreshRolelessUser(context, freshEmail);

    // Go straight to onboarding carrying the role hint, exactly like the
    // onboarding-guard would after a real post-signup landing on /app.
    // ?role=stylist survives boot: OnboardingPage reads it via
    // readPrefilledRole(router.query) — no auth redirect consumes the param.
    await page.goto('/app/onboarding?role=stylist');

    // The flow opens on the ROLE step (role-only onboarding, 2026-10-15), so
    // the cards are there at once. The prefilled role ('stylist') is seeded
    // into the form's defaultValues. The first assertion auto-waits for the
    // card, which IS the hydration signal (replaces networkidle).

    // (a) The stylist RoleCard renders as a checked radio. Selector mirrors
    //     OnboardingStepRole's RoleCard (role="radio" data-role aria-checked) —
    //     copy/CSS-hash-proof, asserts the prefilled selection directly.
    await expect(
      page.locator('[role="radio"][data-role="stylist"][aria-checked="true"]')
    ).toBeVisible();

    // The client card must NOT be the selected one (prefill picked stylist).
    await expect(
      page.locator('[role="radio"][data-role="client"]')
    ).toHaveAttribute('aria-checked', 'false');

    // (b) The prefill hint is visible. The hint <span> carries no stable
    //     role/testid, so we match a copy-stable PL fragment (default e2e
    //     locale). i18n key pages.onboarding.rolePrefilledHint. Match only the
    //     stable word „rejestracji”: the surrounding words get reworded.
    await expect(page.getByText(/rejestracji/i)).toBeVisible();
  });
});
